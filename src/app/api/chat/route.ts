import { NextRequest } from 'next/server';
import { streamClaude } from '@/lib/claude-client';
import { streamCodex } from '@/lib/codex-client';
import { streamPi } from '@/lib/pi-client';
import { addMessage, createAssistantPlaceholderMessage, deleteMessageRecord, getAssistantMessageByClientMessageId, getMessages, getSession, MessageIdempotencyConflictError, replaceMessageParts, updateSessionTitle, updateSessionMode, updateSessionModel, updateSessionProvider, updateSessionProviderId, updateSessionAssistantRuntime, updateSessionAssistantRuntimeVersion, getSetting, getProvider, getDefaultProviderId, acquireSessionLock, renewSessionLock, releaseSessionLock, syncSdkTasks, upsertAssistantMessage, upsertMessageParts, upsertSessionRuntimeState, getSessionRuntimeState, upsertUserMessage } from '@/lib/db';
import { sessionStateManager } from '@/lib/session-state-manager';
import { agentOrchestrator } from '@/lib/agent-runtime/orchestrator';
import { sdkAdapter } from '@/lib/agent-runtime/sdk-adapter';
import { getAssistantRuntimeStatus, getAssistantRuntimeVersion, getDefaultAssistantRuntime } from '@/lib/assistant-runtimes';
import { registerActiveChatRun, unregisterActiveChatRun } from '@/lib/active-chat-run-registry';
import { buildMessagePartInputs, serializeMessageContentBlocks } from '@/lib/message-content';
import { persistAssistantTerminalStateDirect } from '@/lib/chat/assistant-terminal-persistence';
import { createCheckpointFlusher } from '@/lib/chat/persistence';
import { wrapStreamWithHeartbeat, wrapStreamWithSSEEvents } from '@/lib/chat/persisted-sse';
import { buildConversationHistoryForPrompt } from '@/lib/chat-route-history';
import { normalizeCodexModel, resolvePreferredCodexModel } from '@/lib/codex-model';
import { getChatRolloutMode } from '@/lib/chat-rollout';
import { evaluateCodexResumeInvalidation } from '@/lib/codex-resume-contract';
import { getProjectUploadDir } from '@/lib/upload-paths';
import { WIDGET_SYSTEM_PROMPT } from '@/lib/widget-guidelines';
import { shouldInjectWidgetPrompt } from '@/lib/widget-heuristics';
import {
  buildContextBudgetLogFields,
  normalizeContextLimitErrorMessage,
  prepareConversationContext,
} from '@/lib/context-budget';
import { parseMessageContent, SETTING_KEYS } from '@/types';
import type {
  AssistantPersistedEventData,
  AssistantRuntime,
  FileAttachment,
  Message,
  MessageContentBlock,
  SendMessageRequest,
  SSEEvent,
  TokenUsage,
  UserPersistedEventData,
} from '@/types';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureNativeSessionRuntime } from '@/lib/native-session-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeSSEEvent(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function createReplaySSEStream(events: SSEEvent[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(serializeSSEEvent(event));
      }
      controller.close();
    },
  });
}

function createChatSSEHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
}

function buildNotificationStatusEvent(
  title: string,
  message: string,
): SSEEvent {
  return {
    type: 'status',
    data: JSON.stringify({
      notification: true,
      title,
      message,
    }),
  };
}

function buildAssistantPersistedAck(
  sessionId: string,
  clientMessageId: string,
  assistantMessage: Message,
): AssistantPersistedEventData {
  return {
    session_id: sessionId,
    client_message_id: clientMessageId,
    message_id: assistantMessage.id,
    revision: Math.max(assistantMessage.persisted_revision ?? 0, 0),
    created_at: assistantMessage.created_at,
  };
}

function canReplayExistingAssistantTurn(message: Message): boolean {
  if (message.status === 'error' || message.status === 'streaming') {
    return false;
  }

  if (message.status === 'completed' || Boolean(message.completed_at)) {
    return true;
  }

  if ((message.persisted_revision ?? 0) > 0) {
    return true;
  }

  return message.content.trim().length > 0;
}

function canRestartExistingAssistantTurn(message: Message): boolean {
  return message.status === 'error';
}

function canRestartOrphanedStreamingAssistantTurn(
  message: Message,
  sessionRuntimeStatus: string | null | undefined,
): boolean {
  const runtimeLooksActive = sessionRuntimeStatus === 'running'
    || sessionRuntimeStatus === 'waiting_permission'
    || sessionRuntimeStatus === 'stopping';
  if (runtimeLooksActive) {
    return false;
  }

  return message.status === 'streaming'
    && message.content.trim().length === 0
    && !message.completed_at
    && (message.persisted_revision ?? 0) <= 0;
}

function buildReplayEventsForAssistant(message: Message): SSEEvent[] {
  const events: SSEEvent[] = [];

  for (const block of parseMessageContent(message.content)) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          events.push({ type: 'text', data: block.text });
        }
        break;
      case 'reasoning':
        if (block.text) {
          events.push({ type: 'reasoning', data: block.text });
        }
        break;
      case 'tool_use':
        events.push({
          type: 'tool_use',
          data: JSON.stringify({ id: block.id, name: block.name, input: block.input }),
        });
        break;
      case 'tool_result':
        events.push({
          type: 'tool_result',
          data: JSON.stringify({
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          }),
        });
        break;
      case 'code':
        events.push({
          type: 'text',
          data: `\`\`\`${block.language}\n${block.code}\n\`\`\``,
        });
        break;
      default:
        break;
    }
  }

  if (message.token_usage) {
    try {
      const usage = JSON.parse(message.token_usage) as TokenUsage;
      events.push({
        type: 'result',
        data: JSON.stringify({ usage }),
      });
    } catch {
      // best effort
    }
  }

  return events;
}

function buildChatSSEStreamResponse(
  stream: ReadableStream<string>,
  userPersistedAck: UserPersistedEventData | null,
  persistedAckPromise: Promise<AssistantPersistedEventData | null>,
  prependEvents: SSEEvent[] = [],
): Response {
  return new Response(wrapStreamWithSSEEvents(stream, {
    prependEvents: [
      ...(userPersistedAck
        ? [{ type: 'user_persisted', data: JSON.stringify(userPersistedAck) } satisfies SSEEvent]
        : []),
      ...prependEvents,
    ],
    appendEventPromises: [
      persistedAckPromise.then((persistedAck) => (
        persistedAck
          ? { type: 'persisted', data: JSON.stringify(persistedAck) }
          : null
      )),
    ],
  }), {
    headers: createChatSSEHeaders(),
  });
}

export async function POST(request: NextRequest) {
  let activeSessionId: string | undefined;
  let activeLockId: string | undefined;
  let cleanupRun: (() => void) | null = null;
  let stopSignalWatchTimer: ReturnType<typeof setInterval> | null = null;

  try {
    const body: SendMessageRequest & {
      files?: FileAttachment[];
      toolTimeout?: number;
      provider_id?: string;
      systemPromptAppend?: string;
    } = await request.json();
    const {
      session_id,
      content: rawContent,
      display_content: rawDisplayContent,
      model,
      mode,
      files,
      toolTimeout,
      provider_id,
      systemPromptAppend,
      client_message_id,
      assistant_runtime,
    } = body;

    if (!session_id || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'session_id and content are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const content = rawContent;
    const sanitizedClientMessageId = (typeof client_message_id === 'string' && client_message_id.length <= 128)
      ? client_message_id
      : null;
    const chatRolloutMode = getChatRolloutMode();

    console.log('[chat API] content length:', content.length, 'first 200 chars:', content.slice(0, 200));
    console.log('[chat API] systemPromptAppend:', systemPromptAppend ? `${systemPromptAppend.length} chars` : 'none');

    const session = getSession(session_id) || ensureNativeSessionRuntime(session_id, assistant_runtime);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (session.session_type !== 'chat') {
      return new Response(JSON.stringify({ error: 'session_id must be a chat session' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // P1 fix: Session runtime is immutable after creation
    // Always use the session's saved runtime, ignore any runtime from request body
    const effectiveRuntime: AssistantRuntime = session.assistant_runtime || getDefaultAssistantRuntime();
    const runtimeStatus = await getAssistantRuntimeStatus(effectiveRuntime);
    const canLaunchExistingPiSession = runtimeStatus?.id === 'pi' && runtimeStatus.launchable;
    if (!runtimeStatus || (!runtimeStatus.available && !canLaunchExistingPiSession)) {
      console.warn('[chat API] assistant runtime unavailable', {
        session_id,
        assistant_runtime: effectiveRuntime,
        status_message: runtimeStatus?.status_message || 'unknown',
      });
      return new Response(
        JSON.stringify({
          error: runtimeStatus?.status_message || `${effectiveRuntime} is not available`,
          code: 'ASSISTANT_RUNTIME_UNAVAILABLE',
          assistant_runtime: effectiveRuntime,
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Acquire exclusive lock for this session to prevent concurrent requests
    const lockId = crypto.randomBytes(8).toString('hex');
    const lockAcquired = acquireSessionLock(session_id, lockId, `chat-${process.pid}`, 600);
    if (!lockAcquired) {
      return new Response(
        JSON.stringify({ error: 'Session is busy processing another request', code: 'SESSION_BUSY' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }
    activeSessionId = session_id;
    activeLockId = lockId;
    sessionStateManager.updateSessionState(session_id, {
      runtimeStatus: 'running',
      sdkCwd: session.sdk_cwd || session.working_directory || '',
    });
    const finishLockedRequest = () => {
      if (stopSignalWatchTimer) {
        clearInterval(stopSignalWatchTimer);
        stopSignalWatchTimer = null;
      }
      if (activeSessionId && activeLockId) {
        releaseSessionLock(activeSessionId, activeLockId);
        activeSessionId = undefined;
        activeLockId = undefined;
      }
      sessionStateManager.updateSessionState(session_id, {
        runtimeStatus: 'idle',
        runtimeError: '',
      });
      upsertSessionRuntimeState(session_id, {
        status: 'idle',
        pendingPermissions: [],
        generationQueue: [],
      });
    };

    // Save user message — persist file metadata so attachments survive page reload
    const persistedDisplayContent = (
      typeof rawDisplayContent === 'string' && rawDisplayContent.trim().length > 0
    )
      ? rawDisplayContent
      : content;

    let savedContent = persistedDisplayContent;
    let fileMeta: Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      filePath: string;
      sourcePath?: string;
    }> | undefined;
    if (files && files.length > 0) {
      const workDir = session.working_directory;
      const uploadDir = getProjectUploadDir(workDir);
      fileMeta = files.map((f) => {
        const safeName = path.basename(f.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
        const buffer = Buffer.from(f.data, 'base64');
        fs.writeFileSync(filePath, buffer);
        return {
          id: f.id,
          name: f.name,
          type: f.type,
          size: buffer.length,
          filePath,
          sourcePath: typeof f.sourcePath === 'string' && f.sourcePath.trim().length > 0
            ? f.sourcePath
            : undefined,
        };
      });
      savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${persistedDisplayContent}`;
    }
    const userMessage = sanitizedClientMessageId
      ? upsertUserMessage(session_id, sanitizedClientMessageId, savedContent, null)
      : addMessage(
        session_id,
        'user',
        savedContent,
        null,
        sanitizedClientMessageId,
      );
    replaceMessageParts(userMessage.id, session_id, [{ partType: 'text', content: savedContent, metadata: null }]);
    const userPersistedAck: UserPersistedEventData | null = sanitizedClientMessageId
      ? {
        session_id,
        client_message_id: sanitizedClientMessageId,
        message_id: userMessage.id,
        created_at: userMessage.created_at,
      }
      : null;
    const existingAssistantMessage = sanitizedClientMessageId
      ? getAssistantMessageByClientMessageId(session_id, sanitizedClientMessageId)
      : undefined;

    if (sanitizedClientMessageId && existingAssistantMessage) {
      if (canReplayExistingAssistantTurn(existingAssistantMessage)) {
        const persistedAck = buildAssistantPersistedAck(
          session_id,
          sanitizedClientMessageId,
          existingAssistantMessage,
        );
        const replayStream = createReplaySSEStream(buildReplayEventsForAssistant(existingAssistantMessage));
        finishLockedRequest();
        return buildChatSSEStreamResponse(
          replayStream,
          userPersistedAck,
          Promise.resolve(persistedAck),
        );
      }

      if (
        canRestartExistingAssistantTurn(existingAssistantMessage)
        || canRestartOrphanedStreamingAssistantTurn(existingAssistantMessage, session.runtime_status)
      ) {
        console.info('[chat API] restarting failed assistant turn', {
          session_id,
          client_message_id: sanitizedClientMessageId,
          assistant_message_id: existingAssistantMessage.id,
        });
      } else {
        finishLockedRequest();
        return new Response(
          JSON.stringify({
            error: 'Duplicate client_message_id is already bound to an assistant turn that is not replayable',
            code: 'DUPLICATE_CLIENT_MESSAGE_IN_PROGRESS',
            client_message_id: sanitizedClientMessageId,
            assistant_message_id: existingAssistantMessage.id,
            assistant_status: existingAssistantMessage.status ?? null,
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

    }

    // Auto-generate title from first message if still default
    if (session.title === 'New Chat') {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      updateSessionTitle(session_id, title);
    }

    if (effectiveRuntime !== (session.assistant_runtime || 'claude_code')) {
      updateSessionAssistantRuntime(session_id, effectiveRuntime);
    }
    void getAssistantRuntimeVersion(effectiveRuntime).then((runtimeVersion) => {
      if (runtimeVersion && runtimeVersion !== session.assistant_runtime_version) {
        updateSessionAssistantRuntimeVersion(session_id, runtimeVersion);
      }
    }).catch(() => {
      // best effort metadata update
    });

    // Determine model: request override > session model > runtime default setting
    const requestedModel = effectiveRuntime === 'codex'
      ? normalizeCodexModel(model)
      : model || undefined;
    const persistedSessionModel = effectiveRuntime === 'codex'
      ? normalizeCodexModel(session.model)
      : session.model || undefined;
    const runtimeDefaultModel = effectiveRuntime === 'codex'
      ? resolvePreferredCodexModel()
      : effectiveRuntime === 'claude_code'
      ? getSetting('default_model') || undefined
      : effectiveRuntime === 'pi'
      ? getSetting(SETTING_KEYS.PI_DEFAULT_MODEL) || undefined
      : undefined;
    const effectiveModel = requestedModel || persistedSessionModel || runtimeDefaultModel || undefined;
    const resumeComparableSessionModel = effectiveRuntime === 'codex'
      ? (persistedSessionModel || undefined)
      : (session.model || undefined);

    console.info('[chat API] routing request', {
      session_id,
      rollout_mode: chatRolloutMode,
      assistant_runtime: effectiveRuntime,
      codex_backend: effectiveRuntime === 'codex' ? 'app-server' : null,
      mode: mode || session.mode || 'code',
      model: effectiveModel || '',
      requestedModel,
      persistedSessionModel,
      runtimeDefaultModel,
    });

    // Persist model and provider to session so usage stats can group by model+provider.
    // This runs on every message but the DB writes are cheap (single UPDATE by PK).
    if (effectiveModel && effectiveModel !== session.model) {
      updateSessionModel(session_id, effectiveModel);
    }

    // Resolve provider: explicit provider_id > default_provider_id > environment variables
    let resolvedProvider: import('@/types').ApiProvider | undefined;
    const effectiveProviderId = provider_id || session.provider_id || '';
    if (effectiveProviderId && effectiveProviderId !== 'env') {
      resolvedProvider = getProvider(effectiveProviderId);
      if (!resolvedProvider) {
        // Requested provider not found, try default
        const defaultId = getDefaultProviderId();
        if (defaultId) {
          resolvedProvider = getProvider(defaultId);
        }
      }
    } else if (!effectiveProviderId) {
      // No provider specified, try default
      const defaultId = getDefaultProviderId();
      if (defaultId) {
        resolvedProvider = getProvider(defaultId);
      }
    }
    // effectiveProviderId === 'env' → resolvedProvider stays undefined → uses env vars

    const providerName = resolvedProvider?.name || '';
    if (effectiveRuntime === 'claude_code' && providerName !== (session.provider_name || '')) {
      updateSessionProvider(session_id, providerName);
    }
    const persistProviderId = effectiveProviderId || provider_id || '';
    if (effectiveRuntime === 'claude_code' && persistProviderId !== (session.provider_id || '')) {
      updateSessionProviderId(session_id, persistProviderId);
    }

    // Determine permission mode from chat mode: code → acceptEdits, plan → plan, ask → default (no tools)
    const effectiveMode = mode || session.mode || 'code';
    let permissionMode: string;
    let systemPromptOverride: string | undefined;
    switch (effectiveMode) {
      case 'plan':
        permissionMode = 'plan';
        break;
      case 'ask':
        permissionMode = 'default';
        systemPromptOverride = (session.system_prompt || '') +
          '\n\nYou are in Ask mode. Answer questions and provide information only. Do not use any tools, do not read or write files, do not execute commands. Only respond with text.';
        break;
      default: // 'code'
        permissionMode = 'acceptEdits';
        break;
    }
    if (effectiveMode !== (session.mode || 'code')) {
      updateSessionMode(session_id, effectiveMode);
    }

    const abortController = new AbortController();

    // Handle client disconnect
    request.signal.addEventListener('abort', () => {
      abortController.abort();
    });

    // Cross-worker stop support:
    // /api/chat/stop writes session_runtime_state.status='stopping'.
    // The active worker polls this flag and aborts the local SDK run.
    stopSignalWatchTimer = setInterval(() => {
      if (abortController.signal.aborted) {
        return;
      }
      try {
        const runtimeState = getSessionRuntimeState(session_id);
        if (runtimeState?.status === 'stopping') {
          abortController.abort();
        }
      } catch {
        // best effort
      }
    }, 400);

    // Convert file attachments to the format expected by streamClaude.
    // Include filePath from the already-saved files so claude-client can
    // reference the on-disk copies instead of writing them again.
    const fileAttachments: FileAttachment[] | undefined = files && files.length > 0
      ? files.map((f, i) => {
          const meta = fileMeta?.find((m: { id: string }) => m.id === f.id);
          const runtimeFilePath = meta?.sourcePath || meta?.filePath;
          return {
            id: f.id || `file-${Date.now()}-${i}`,
            name: f.name,
            type: f.type,
            size: f.size,
            data: (runtimeFilePath && !f.type.startsWith('image/')) ? '' : f.data, // Keep base64 for images (needed for vision); clear for non-images (read from disk)
            filePath: runtimeFilePath,
            sourcePath: meta?.sourcePath,
          };
        })
      : undefined;

    // Append per-request system prompt (e.g. skill injection for image generation)
    let finalSystemPrompt = systemPromptOverride || session.system_prompt || undefined;
    if (systemPromptAppend) {
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + systemPromptAppend;
    }

    const effectiveWorkingDirectory = session.sdk_cwd || session.working_directory || undefined;
    let codexResumeSessionId = session.sdk_session_id || undefined;
    let codexResumeFallbackReason: string | null = codexResumeSessionId
      ? null
      : 'native_resume_missing';
    if (effectiveRuntime === 'codex' && codexResumeSessionId) {
      const invalidationReasons = evaluateCodexResumeInvalidation({
        resumeSessionId: codexResumeSessionId,
        effectiveMode,
        sessionMode: session.mode,
        systemPromptAppend,
        effectiveModel,
        sessionModel: resumeComparableSessionModel,
        sdkCwd: session.sdk_cwd,
        workingDirectory: session.working_directory,
        pathExists: fs.existsSync,
      });

      if (invalidationReasons.length > 0) {
        sessionStateManager.updateSessionState(session_id, { sdkSessionId: '' });
        codexResumeSessionId = undefined;
        codexResumeFallbackReason = `native_resume_invalid:${invalidationReasons.join(',')}`;
        console.info('[chat API] invalidated codex resume session', {
          sessionId: session_id,
          reasons: invalidationReasons,
        });
      }
    }

    const workingDirectoryAvailable = !effectiveWorkingDirectory || fs.existsSync(effectiveWorkingDirectory);
    const claudeResumeActive = Boolean(session.sdk_session_id) && workingDirectoryAvailable;
    const piResumeActive = effectiveRuntime === 'pi'
      && Boolean(session.sdk_session_id)
      && workingDirectoryAvailable;
    const nativeResumeActive = effectiveRuntime === 'codex'
      ? Boolean(codexResumeSessionId)
      : effectiveRuntime === 'pi'
      ? piResumeActive
      : claudeResumeActive;
    const initialFallbackReason = effectiveRuntime === 'codex'
      ? codexResumeFallbackReason
      : session.sdk_session_id && !workingDirectoryAvailable
        ? 'working_directory_missing'
        : nativeResumeActive
          ? null
          : 'native_resume_missing';

    const loadRawEmergencyHistory = () => {
      const { messages: recentMessages } = getMessages(session_id, { limit: 50 });
      return buildConversationHistoryForPrompt(
        recentMessages,
        userMessage.id,
        sanitizedClientMessageId,
      );
    };
    // Every native runtime reads DB history only after resume is known to be
    // absent/invalid, or lazily after a later native resume failure.
    const rawHistoryMsgs = !nativeResumeActive
      ? loadRawEmergencyHistory()
      : [];
    const generativeUIEnabled = shouldInjectWidgetPrompt({
      runtime: effectiveRuntime,
      mode: effectiveMode,
      generativeUISettingEnabled: getSetting(SETTING_KEYS.GENERATIVE_UI_ENABLED) !== 'false',
      messageContent: content,
      systemPromptAppend,
      recentHistory: rawHistoryMsgs,
    });
    if (generativeUIEnabled) {
      finalSystemPrompt = finalSystemPrompt
        ? `${finalSystemPrompt}\n\n${WIDGET_SYSTEM_PROMPT}`
        : WIDGET_SYSTEM_PROMPT;
    }
    const prepareEmergencyHistory = (
      reason: string,
      suppliedHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    ) => {
      const rawHistory = suppliedHistory ?? loadRawEmergencyHistory();
      const prepared = prepareConversationContext({
        runtime: effectiveRuntime === 'codex' ? 'codex' : effectiveRuntime === 'pi' ? 'pi' : 'claude',
        prompt: content,
        systemPrompt: finalSystemPrompt,
        conversationHistory: rawHistory,
        files: fileAttachments,
        useConversationHistory: rawHistory.length > 0,
        includeSystemPrompt: true,
        nativeResumeActive: false,
      });
      console.warn('[chat API] emergency conversation context', {
        session: session_id,
        runtime: effectiveRuntime,
        reason,
        history_messages_before: rawHistory.length,
        history_messages_after: prepared.conversationHistory.length,
        characters_trimmed: prepared.compactionApplied || prepared.hardTrimApplied,
      });
      return prepared;
    };

    const contextBudget = initialFallbackReason
      ? prepareEmergencyHistory(initialFallbackReason, rawHistoryMsgs)
      : prepareConversationContext({
      runtime: effectiveRuntime === 'codex' ? 'codex' : effectiveRuntime === 'pi' ? 'pi' : 'claude',
      prompt: content,
      systemPrompt: finalSystemPrompt,
      conversationHistory: [],
      files: fileAttachments,
      useConversationHistory: false,
      includeSystemPrompt: effectiveRuntime !== 'codex',
      nativeResumeActive,
    });
    console.info('[chat API] context budget', {
      session_id,
      source: 'ui',
      assistant_runtime: effectiveRuntime,
      ...buildContextBudgetLogFields(contextBudget, rawHistoryMsgs.length),
    });
    const preStreamEvents: SSEEvent[] = contextBudget.statusNotice
      ? [buildNotificationStatusEvent(
          contextBudget.statusNotice.title,
          contextBudget.statusNotice.message,
        )]
      : [];

    const historyMsgs = contextBudget.conversationHistory;
    let lazilyPreparedEmergencyHistory: ReturnType<typeof prepareConversationContext> | null = null;
    const loadEmergencyConversationHistory = async (reason: string) => {
      lazilyPreparedEmergencyHistory ??= prepareEmergencyHistory(reason);
      return lazilyPreparedEmergencyHistory.conversationHistory;
    };

    await agentOrchestrator.startSession({
      sessionId: session_id,
      source: 'ui',
      workingDirectory: effectiveWorkingDirectory,
      model: effectiveModel,
    });

    // Stream assistant response, using the runtime session ID for resume if available.
    console.log('[chat API] stream params:', {
      promptLength: content.length,
      promptFirst200: content.slice(0, 200),
      sdkSessionId: codexResumeSessionId || session.sdk_session_id || 'none',
      systemPromptLength: finalSystemPrompt?.length || 0,
      systemPromptFirst200: finalSystemPrompt?.slice(0, 200) || 'none',
      generativeUIEnabled,
    });
    const stream = effectiveRuntime === 'codex'
      ? streamCodex({
          prompt: content,
          sessionId: session_id,
          sdkSessionId: codexResumeSessionId,
          model: effectiveModel,
          systemPrompt: finalSystemPrompt,
          workingDirectory: effectiveWorkingDirectory,
          abortController,
          permissionMode,
          files: fileAttachments,
          conversationHistory: historyMsgs,
          loadEmergencyConversationHistory,
          onSessionIdInvalidated: () => {
            try { sessionStateManager.updateSessionState(session_id, { sdkSessionId: '' }); } catch { /* best effort */ }
          },
          onRuntimeStatusChange: (status: string) => {
            try { sessionStateManager.updateSessionState(session_id, { runtimeStatus: status }); } catch { /* best effort */ }
          },
        })
      : effectiveRuntime === 'pi'
      ? streamPi({
          prompt: content,
          sessionId: session_id,
          sdkSessionId: piResumeActive ? session.sdk_session_id || undefined : undefined,
          model: effectiveModel,
          systemPrompt: finalSystemPrompt,
          workingDirectory: effectiveWorkingDirectory,
          abortController,
          permissionMode,
          files: fileAttachments,
          conversationHistory: historyMsgs,
          loadEmergencyConversationHistory,
          onSessionIdInvalidated: () => {
            try { sessionStateManager.updateSessionState(session_id, { sdkSessionId: '' }); } catch { /* best effort */ }
          },
          onRuntimeStatusChange: (status: string) => {
            try { sessionStateManager.updateSessionState(session_id, { runtimeStatus: status }); } catch { /* best effort */ }
          },
        })
      : streamClaude({
          prompt: content,
          sessionId: session_id,
          sdkSessionId: session.sdk_session_id || undefined,
          model: effectiveModel,
          systemPrompt: finalSystemPrompt,
          workingDirectory: effectiveWorkingDirectory,
          abortController,
          permissionMode,
          files: fileAttachments,
          imageAgentMode: !!systemPromptAppend,
          generativeUI: generativeUIEnabled,
          toolTimeoutSeconds: typeof toolTimeout === 'number' && Number.isFinite(toolTimeout)
            ? Math.max(0, toolTimeout)
            : 300,
          provider: resolvedProvider,
          conversationHistory: historyMsgs,
          loadEmergencyConversationHistory,
          onRuntimeStatusChange: (status: string) => {
            try { sessionStateManager.updateSessionState(session_id, { runtimeStatus: status }); } catch { /* best effort */ }
          },
        });

    // Heartbeats prove transport/runtime liveness without entering persisted history.
    const liveStream = wrapStreamWithHeartbeat(stream, {
      intervalMs: 15_000,
      signal: abortController.signal,
    });
    // Tee the stream: one for client, one for collecting the response
    const [streamForClient, streamForCollect] = liveStream.tee();

    // Periodically renew the session lock so long-running tasks don't expire
    const lockRenewalInterval = setInterval(() => {
      try { renewSessionLock(session_id, lockId, 600); } catch { /* best effort */ }
    }, 60_000);

    let cleaned = false;
    cleanupRun = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      if (stopSignalWatchTimer) {
        clearInterval(stopSignalWatchTimer);
        stopSignalWatchTimer = null;
      }
      clearInterval(lockRenewalInterval);
      releaseSessionLock(session_id, lockId);
      unregisterActiveChatRun(session_id, abortController);
      sessionStateManager.updateSessionState(session_id, {
        runtimeStatus: 'idle',
        runtimeError: '',
      });
      upsertSessionRuntimeState(session_id, {
        status: 'idle',
        pendingPermissions: [],
        generationQueue: [],
      });
    };

    registerActiveChatRun(session_id, {
      abortController,
      cleanup: cleanupRun,
    });

    // Save assistant message in background, with cleanup callback to release lock
    const persistedAckPromise = collectStreamResponse(
      streamForCollect,
      session_id,
      cleanupRun,
      effectiveRuntime !== 'codex' || !systemPromptAppend,
      sanitizedClientMessageId,
      chatRolloutMode,
    );

    return buildChatSSEStreamResponse(
      streamForClient,
      userPersistedAck,
      persistedAckPromise,
      preStreamEvents,
    );
  } catch (error) {
    if (stopSignalWatchTimer) {
      clearInterval(stopSignalWatchTimer);
      stopSignalWatchTimer = null;
    }

    // Release lock and reset status on error (only if lock was acquired)
    if (cleanupRun) {
      try {
        cleanupRun();
      } catch {
        // best effort
      }
    } else if (activeSessionId && activeLockId) {
      try {
        releaseSessionLock(activeSessionId, activeLockId);
      } catch {
        // best effort
      }
    }
    if (activeSessionId) {
      const normalizedErrorMessage = normalizeContextLimitErrorMessage(
        error instanceof Error ? error.message : String(error || 'Unknown error'),
      );
      try {
        agentOrchestrator.markSessionError(
          activeSessionId,
          normalizedErrorMessage,
          'ui',
        );
      } catch {
        // best effort
      }
      try {
        unregisterActiveChatRun(activeSessionId);
      } catch {
        // best effort
      }
    }

    const message = normalizeContextLimitErrorMessage(
      error instanceof Error ? error.message : 'Internal server error',
    );
    return new Response(JSON.stringify({ error: message }), {
      status: error instanceof MessageIdempotencyConflictError ? 409 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function collectStreamResponse(
  stream: ReadableStream<string>,
  sessionId: string,
  onComplete?: () => void,
  persistSdkSessionId = true,
  clientMessageId?: string | null,
  rolloutMode: 'legacy' | 'bridge' | 'canonical' = 'bridge',
): Promise<AssistantPersistedEventData | null> {
  const reader = stream.getReader();
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  let currentReasoning = '';
  let activeBuffer: 'text' | 'reasoning' | null = null;
  let tokenUsage: TokenUsage | null = null;
  let hasError = false;
  let errorMessage = '';
  let sawDoneEvent = false;
  let streamBuffer = '';
  // Dedup layer: skip duplicate tool_result events by tool_use_id
  const seenToolResultIds = new Set<string>();
  let assistantAttemptCheckpoint: {
    contentBlocks: MessageContentBlock[];
    currentText: string;
    currentReasoning: string;
    activeBuffer: 'text' | 'reasoning' | null;
    seenToolResultIds: Set<string>;
  } | null = null;
  const shouldUseBridgePersistence = rolloutMode !== 'legacy';
  const shouldCreatePlaceholder = shouldUseBridgePersistence && typeof clientMessageId === 'string' && clientMessageId.length > 0;
  let assistantMessageId: string | null = null;
  let persistedAssistantAck: AssistantPersistedEventData | null = null;
  let latestAttemptedRevision = 0;

  if (shouldCreatePlaceholder) {
    assistantMessageId = createAssistantPlaceholderMessage(sessionId, clientMessageId).id;
  }

  const discardAssistantPlaceholder = () => {
    if (!assistantMessageId) {
      return false;
    }

    const deleted = deleteMessageRecord(assistantMessageId);
    assistantMessageId = null;
    persistedAssistantAck = null;
    return deleted;
  };

  const buildLiveContentBlocks = (): MessageContentBlock[] => {
    const blocks = contentBlocks.map((block) => structuredClone(block));

    if (activeBuffer === 'text' && currentText.trim()) {
      blocks.push({ type: 'text', text: currentText });
    } else if (activeBuffer === 'reasoning') {
      const normalized = currentReasoning.trim();
      if (normalized) {
        blocks.push({ type: 'reasoning', text: normalized });
      }
    }

    return blocks;
  };

  const checkpointFlusher = shouldCreatePlaceholder && clientMessageId && assistantMessageId
    ? createCheckpointFlusher({
      getSnapshot: buildLiveContentBlocks,
      persistSnapshot: async ({ blocks, revision, isFinal, terminalStatus }) => {
        if (!assistantMessageId) {
          return;
        }
        latestAttemptedRevision = revision;

        const updatedAt = Date.now();

        if (!isFinal) {
          upsertMessageParts(
            assistantMessageId,
            sessionId,
            buildMessagePartInputs(blocks, {
              includeStableKeys: true,
              revision,
              isFinal: false,
              updatedAt,
            }),
          );
          return;
        }

        if (!terminalStatus) {
          throw new Error('Missing terminal status for final checkpoint persistence');
        }

        persistedAssistantAck = persistAssistantTerminalStateDirect({
          sessionId,
          messageId: assistantMessageId,
          clientMessageId,
          blocks,
          tokenUsage,
          terminalStatus,
          revision,
        });
      },
      onDegraded: (error) => {
        console.warn('[chat persistence] checkpoint flush degraded', {
          sessionId,
          clientMessageId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    })
    : null;

  const captureAssistantAttemptCheckpoint = () => {
    assistantAttemptCheckpoint = {
      contentBlocks: contentBlocks.map((block) => structuredClone(block)),
      currentText,
      currentReasoning,
      activeBuffer,
      seenToolResultIds: new Set(seenToolResultIds),
    };
  };

  const restoreAssistantAttemptCheckpoint = () => {
    if (!assistantAttemptCheckpoint) return;
    contentBlocks.splice(
      0,
      contentBlocks.length,
      ...assistantAttemptCheckpoint.contentBlocks.map((block) => structuredClone(block)),
    );
    currentText = assistantAttemptCheckpoint.currentText;
    currentReasoning = assistantAttemptCheckpoint.currentReasoning;
    activeBuffer = assistantAttemptCheckpoint.activeBuffer;
    seenToolResultIds.clear();
    for (const id of assistantAttemptCheckpoint.seenToolResultIds) {
      seenToolResultIds.add(id);
    }
    assistantAttemptCheckpoint = null;
    checkpointFlusher?.markDirty({ immediate: true });
  };

  const persistAssistantTerminalState = async (terminalStatus: 'completed' | 'error') => {
    const finalBlocks = buildLiveContentBlocks();
    if (finalBlocks.length === 0) {
      discardAssistantPlaceholder();
      return null;
    }

    if (checkpointFlusher) {
      await checkpointFlusher.finalize(terminalStatus);
      if (checkpointFlusher.isDegraded()) {
        if (!assistantMessageId || !clientMessageId) {
          return assistantMessageId;
        }

        persistedAssistantAck = persistAssistantTerminalStateDirect({
          sessionId,
          messageId: assistantMessageId,
          clientMessageId,
          blocks: finalBlocks,
          tokenUsage,
          terminalStatus,
          revision: Math.max(latestAttemptedRevision, finalBlocks.length > 0 ? 1 : 0),
        });
      }
      return persistedAssistantAck?.message_id ?? assistantMessageId;
    }

    const content = serializeMessageContentBlocks(finalBlocks);
    const tokenUsagePayload = tokenUsage ? JSON.stringify(tokenUsage) : null;
    const persistedRevision = shouldUseBridgePersistence && finalBlocks.length > 0 ? 1 : 0;
    const completedAt = new Date().toISOString().replace('T', ' ').split('.')[0];
    const message = shouldCreatePlaceholder && clientMessageId
      ? upsertAssistantMessage(
        sessionId,
        clientMessageId,
        content,
        tokenUsagePayload,
        shouldUseBridgePersistence
          ? {
            status: terminalStatus,
            contentFormatVersion: 2,
            completedAt,
            persistedRevision,
          }
          : undefined,
      )
      : content
        ? addMessage(
          sessionId,
          'assistant',
          content,
          tokenUsagePayload,
          clientMessageId ?? null,
          shouldUseBridgePersistence
            ? {
              status: terminalStatus,
              contentFormatVersion: 2,
              completedAt,
              persistedRevision,
            }
            : undefined,
        )
        : null;

    if (!message) {
      return null;
    }

    replaceMessageParts(
      message.id,
      sessionId,
      buildMessagePartInputs(finalBlocks, shouldUseBridgePersistence
        ? {
          includeStableKeys: true,
          revision: persistedRevision,
          isFinal: true,
          updatedAt: Date.now(),
        }
        : undefined),
    );

    if (shouldUseBridgePersistence && clientMessageId) {
      persistedAssistantAck = {
        session_id: sessionId,
        client_message_id: clientMessageId,
        message_id: message.id,
        revision: persistedRevision,
        created_at: message.created_at,
      };
    }

    return message.id;
  };

  const flushTextBuffer = () => {
    if (!currentText.trim()) {
      currentText = '';
      return;
    }
    contentBlocks.push({ type: 'text', text: currentText });
    currentText = '';
  };

  const flushReasoningBuffer = () => {
    const normalized = currentReasoning.trim();
    if (!normalized) {
      currentReasoning = '';
      return;
    }
    contentBlocks.push({ type: 'reasoning', text: normalized });
    currentReasoning = '';
  };

  const flushActiveBuffer = () => {
    if (activeBuffer === 'text') {
      flushTextBuffer();
    } else if (activeBuffer === 'reasoning') {
      flushReasoningBuffer();
    }
    activeBuffer = null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamBuffer += value;
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line.startsWith('data: ')) {
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            const agentEvent = sdkAdapter.adaptSSEEvent(event, {
              sessionId,
              source: 'sdk',
            });
            if (agentEvent) {
              agentOrchestrator.handleEvent(agentEvent);
            }
            if (event.type === 'assistant_attempt_start') {
              captureAssistantAttemptCheckpoint();
            } else if (event.type === 'assistant_attempt_reset') {
              restoreAssistantAttemptCheckpoint();
            } else if (event.type === 'permission_request' || event.type === 'tool_output') {
              // Skip permission_request and tool_output events - not saved as message content
            } else if (event.type === 'text') {
              if (activeBuffer === 'reasoning') {
                flushReasoningBuffer();
                checkpointFlusher?.markDirty({ immediate: true });
              }
              currentText += event.data;
              activeBuffer = 'text';
              checkpointFlusher?.markDirty({ textDelta: event.data.length });
            } else if (event.type === 'reasoning') {
              if (activeBuffer === 'text') {
                flushTextBuffer();
                checkpointFlusher?.markDirty({ immediate: true });
              }
              currentReasoning += event.data;
              activeBuffer = 'reasoning';
              checkpointFlusher?.markDirty({ textDelta: event.data.length });
            } else if (event.type === 'tool_use') {
              flushActiveBuffer();
              try {
                const toolData = JSON.parse(event.data);
                const toolUseId = typeof toolData.id === 'string' ? toolData.id : '';
                if (!toolUseId) {
                  throw new Error('Malformed tool_use id');
                }
                contentBlocks.push({
                  type: 'tool_use',
                  id: toolUseId,
                  name: toolData.name,
                  input: toolData.input,
                });
                checkpointFlusher?.markDirty({ immediate: true });
              } catch {
                // skip malformed tool_use data
              }
            } else if (event.type === 'tool_result') {
              flushActiveBuffer();
              try {
                const resultData = JSON.parse(event.data);
                const toolUseId = typeof resultData.tool_use_id === 'string' ? resultData.tool_use_id : '';
                if (!toolUseId) {
                  throw new Error('Malformed tool_result id');
                }
                const newBlock = {
                  type: 'tool_result' as const,
                  tool_use_id: toolUseId,
                  content: resultData.content,
                  is_error: resultData.is_error || false,
                };
                // Last-wins: if same tool_use_id already exists, replace it
                // (user handler's result may be more complete than PostToolUse's)
                if (seenToolResultIds.has(toolUseId)) {
                  const idx = contentBlocks.findIndex(
                    (b) => b.type === 'tool_result' && 'tool_use_id' in b && b.tool_use_id === toolUseId
                  );
                  if (idx >= 0) {
                    contentBlocks[idx] = newBlock;
                  }
                } else {
                  seenToolResultIds.add(toolUseId);
                  contentBlocks.push(newBlock);
                }
                checkpointFlusher?.markDirty({ immediate: true });
              } catch {
                // skip malformed tool_result data
              }
            } else if (event.type === 'status') {
              // Capture SDK session_id and model from init event and persist them
              try {
                const statusData = JSON.parse(event.data);
                if (persistSdkSessionId && statusData.session_id) {
                  sessionStateManager.updateSessionState(sessionId, { sdkSessionId: statusData.session_id });
                }
                if (statusData.model && statusData.model !== 'codex') {
                  updateSessionModel(sessionId, statusData.model);
                }
              } catch {
                // skip malformed status data
              }
            } else if (event.type === 'task_update') {
              // Sync SDK TodoWrite tasks to local DB
              try {
                const taskData = JSON.parse(event.data);
                if (taskData.session_id && taskData.todos) {
                  syncSdkTasks(taskData.session_id, taskData.todos);
                }
              } catch {
                // skip malformed task_update data
              }
            } else if (event.type === 'error') {
              hasError = true;
              errorMessage = normalizeContextLimitErrorMessage(event.data || 'Unknown error');
            } else if (event.type === 'done') {
              sawDoneEvent = true;
            } else if (event.type === 'result') {
              try {
                const resultData = JSON.parse(event.data);
                if (resultData.usage) {
                  tokenUsage = resultData.usage;
                }
                if (resultData.is_error) {
                  hasError = true;
                }
                // Also capture session_id from result if we missed it from init
                if (persistSdkSessionId && resultData.session_id) {
                  sessionStateManager.updateSessionState(sessionId, { sdkSessionId: resultData.session_id });
                }
              } catch {
                // skip malformed result data
              }
            }
          } catch {
            // skip malformed lines
          }
        }

        if (sawDoneEvent) {
          try {
            await reader.cancel();
          } catch {
            // best effort
          }
          break;
        }
      }

      if (sawDoneEvent) {
        break;
      }
    }

    // Flush any remaining text/reasoning in event order
    flushActiveBuffer();

    await persistAssistantTerminalState(hasError ? 'error' : 'completed');
  } catch (e) {
    hasError = true;
    errorMessage = normalizeContextLimitErrorMessage(
      e instanceof Error ? e.message : 'Stream reading error',
    );
    agentOrchestrator.markSessionError(sessionId, errorMessage, 'sdk');
    // Stream reading error - best effort save
    flushActiveBuffer();
    await persistAssistantTerminalState('error');
  } finally {
    await checkpointFlusher?.dispose();
    onComplete?.();
  }

  return persistedAssistantAck;
}
