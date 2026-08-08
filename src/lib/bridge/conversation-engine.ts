/**
 * Conversation Engine — processes inbound IM messages through Claude.
 *
 * Takes a ChannelBinding + inbound message, calls streamClaude(),
 * consumes the SSE stream server-side, saves messages to DB,
 * and returns the response text for delivery.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ChannelBinding } from './types';
import type {
  AssistantPersistedEventData,
  SSEEvent,
  TokenUsage,
  MessageContentBlock,
  FileAttachment,
} from '@/types';
import { buildMessagePartInputs } from '../message-content';
import { persistAssistantTerminalStateDirect as persistAssistantTerminalStateDirectToDb } from '../chat/assistant-terminal-persistence';
import { createCheckpointFlusher } from '../chat/persistence';
import { streamClaude } from '../claude-client';
import { sessionStateManager } from '../session-state-manager';
import { agentOrchestrator } from '../agent-runtime/orchestrator';
import { sdkAdapter } from '../agent-runtime/sdk-adapter';
import { createEventMetadata } from '../agent-runtime/event-types';
import {
  buildContextBudgetLogFields,
  formatContextLimitExceededMessage,
  normalizeContextLimitErrorMessage,
  prepareConversationContext,
} from '../context-budget';
import {
  createAssistantPlaceholderMessage,
  deleteMessageRecord,
  replaceMessageParts,
  getMessages,
  acquireSessionLock,
  renewSessionLock,
  releaseSessionLock,
  updateSessionModel,
  syncSdkTasks,
  getSession,
  getProvider,
  getDefaultProviderId,
  getSetting,
  recordContextBudgetEvent,
  updateContextBudgetRecoveryMetrics,
  upsertMessageParts,
  upsertUserMessage,
} from '../db';
import { getProjectUploadDir } from '../upload-paths';

export interface PermissionRequestInfo {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: unknown[];
}

/**
 * Callback invoked immediately when a permission_request SSE event arrives.
 * This breaks the deadlock: the stream blocks until the permission is resolved,
 * so we must forward the request to the IM *during* stream consumption,
 * not after it returns.
 */
export type OnPermissionRequest = (perm: PermissionRequestInfo) => Promise<void>;

export interface ConversationResult {
  responseText: string;
  tokenUsage: TokenUsage | null;
  hasError: boolean;
  errorMessage: string;
  /** Permission request events that were forwarded during streaming */
  permissionRequests: PermissionRequestInfo[];
  /** SDK session ID captured from status/result events, for session resume */
  sdkSessionId: string | null;
}

/**
 * Process an inbound message: send to Claude, consume the response stream,
 * save to DB, and return the result.
 */
export async function processMessage(
  binding: ChannelBinding,
  text: string,
  onPermissionRequest?: OnPermissionRequest,
  abortSignal?: AbortSignal,
  files?: FileAttachment[],
): Promise<ConversationResult> {
  const sessionId = binding.sessionId;

  // Acquire session lock
  const lockId = crypto.randomBytes(8).toString('hex');
  const lockAcquired = acquireSessionLock(sessionId, lockId, `bridge-${binding.channelType}`, 600);
  if (!lockAcquired) {
    return {
      responseText: '',
      tokenUsage: null,
      hasError: true,
      errorMessage: 'Session is busy processing another request',
      permissionRequests: [],
      sdkSessionId: null,
    };
  }

  sessionStateManager.updateSessionState(sessionId, {
    runtimeStatus: 'running',
    sdkCwd: binding.workingDirectory || '',
  });

  // Lock renewal interval
  const renewalInterval = setInterval(() => {
    try { renewSessionLock(sessionId, lockId, 600); } catch { /* best effort */ }
  }, 60_000);

  try {
    // Resolve session early — needed for workingDirectory and provider resolution
    const session = getSession(sessionId);

    // Save user message — persist file attachments to disk using the same
    // <!--files:JSON--> format as the desktop chat route, so the UI can render them.
    let savedContent = text;
    if (files && files.length > 0) {
      const workDir = binding.workingDirectory || session?.working_directory || '';
      if (workDir) {
        try {
          const uploadDir = getProjectUploadDir(workDir);
          const fileMeta = files.map((f) => {
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
          savedContent = `<!--files:${JSON.stringify(fileMeta)}-->${text}`;
        } catch (err) {
          console.warn('[conversation-engine] Failed to persist file attachments:', err instanceof Error ? err.message : err);
          savedContent = `[${files.length} image(s) attached] ${text}`;
        }
      } else {
        savedContent = `[${files.length} image(s) attached] ${text}`;
      }
    }
    const userClientMessageId = `bridge-user-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const userMessage = upsertUserMessage(sessionId, userClientMessageId, savedContent);
    replaceMessageParts(userMessage.id, sessionId, [{ partType: 'text', content: savedContent, metadata: null }]);

    // Resolve provider
    let resolvedProvider: import('@/types').ApiProvider | undefined;
    const providerId = session?.provider_id || '';
    if (providerId && providerId !== 'env') {
      resolvedProvider = getProvider(providerId);
    }
    if (!resolvedProvider) {
      const defaultId = getDefaultProviderId();
      if (defaultId) resolvedProvider = getProvider(defaultId);
    }

    // Effective model
    const effectiveModel = binding.model || session?.model || getSetting('default_model') || undefined;

    // Permission mode from binding mode
    let permissionMode: string;
    switch (binding.mode) {
      case 'plan': permissionMode = 'plan'; break;
      case 'ask': permissionMode = 'default'; break;
      default: permissionMode = 'acceptEdits'; break;
    }

    const effectiveWorkingDirectory = binding.workingDirectory || session?.working_directory || undefined;
    const nativeResumeActive = Boolean(binding.sdkSessionId)
      && (!effectiveWorkingDirectory || fs.existsSync(effectiveWorkingDirectory));

    // Load conversation history for context
    const { messages: recentMsgs } = getMessages(sessionId, { limit: 50 });
    const rawHistoryMsgs = recentMsgs.slice(0, -1).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const contextBudget = prepareConversationContext({
      runtime: 'claude',
      prompt: text,
      systemPrompt: session?.system_prompt || undefined,
      conversationHistory: rawHistoryMsgs,
      files,
      useConversationHistory: !nativeResumeActive,
      includeSystemPrompt: true,
      nativeResumeActive,
    });
    console.info('[bridge conversation] context budget', {
      sessionId,
      source: 'bridge',
      ...buildContextBudgetLogFields(contextBudget, rawHistoryMsgs.length),
    });
    let contextBudgetEventId: string | null = null;
    try {
      contextBudgetEventId = recordContextBudgetEvent({
        sessionId,
        source: 'bridge',
        assistantRuntime: 'claude_code',
        context: contextBudget,
        historyBeforeCount: rawHistoryMsgs.length,
      });
    } catch (error) {
      console.warn('[bridge conversation] failed to persist context budget event', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (contextBudget.breakdown.total >= contextBudget.limits.hardLimit) {
      return {
        responseText: '',
        tokenUsage: null,
        hasError: true,
        errorMessage: formatContextLimitExceededMessage({
          breakdown: contextBudget.breakdown,
          nativeResumeActive,
          officialCompactAttempted: contextBudget.officialCompactAttempted,
          localCompactionAttempted: contextBudget.localCompactionAttempted,
        }),
        permissionRequests: [],
        sdkSessionId: null,
      };
    }

    const historyMsgs = contextBudget.conversationHistory;

    await agentOrchestrator.startSession({
      sessionId,
      source: 'bridge',
      workingDirectory: effectiveWorkingDirectory,
      model: effectiveModel,
    });

    const abortController = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        abortController.abort();
      } else {
        abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }

    const stream = streamClaude({
      prompt: text,
      sessionId,
      sdkSessionId: binding.sdkSessionId || undefined,
      model: effectiveModel,
      systemPrompt: session?.system_prompt || undefined,
      workingDirectory: effectiveWorkingDirectory,
      abortController,
      permissionMode,
      provider: resolvedProvider,
      conversationHistory: historyMsgs,
      files,
      onContextBudgetRecovery: contextBudgetEventId
        ? (metrics) => updateContextBudgetRecoveryMetrics(contextBudgetEventId!, metrics)
        : undefined,
      onRuntimeStatusChange: (status: string) => {
        try { sessionStateManager.updateSessionState(sessionId, { runtimeStatus: status }); } catch { /* best effort */ }
      },
    });

    // Consume the stream server-side (replicate collectStreamResponse pattern).
    // Permission requests are forwarded immediately via the callback during streaming
    // because the stream blocks until permission is resolved — we can't wait until after.
    return await consumeStream(stream, sessionId, onPermissionRequest);
  } finally {
    clearInterval(renewalInterval);
    releaseSessionLock(sessionId, lockId);
    sessionStateManager.updateSessionState(sessionId, { runtimeStatus: 'idle', runtimeError: '' });
  }
}

/**
 * Consume an SSE stream and extract response data.
 * Mirrors the collectStreamResponse() logic from chat/route.ts.
 */
export async function consumeStream(
  stream: ReadableStream<string>,
  sessionId: string,
  onPermissionRequest?: OnPermissionRequest,
): Promise<ConversationResult> {
  const reader = stream.getReader();
  const assistantClientMessageId = `bridge-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const assistantMessageId = createAssistantPlaceholderMessage(sessionId, assistantClientMessageId).id;
  const contentBlocks: MessageContentBlock[] = [];
  let currentText = '';
  let currentReasoning = '';
  let activeBuffer: 'text' | 'reasoning' | null = null;
  let tokenUsage: TokenUsage | null = null;
  let hasError = false;
  let errorMessage = '';
  let sawDoneEvent = false;
  let streamBuffer = '';
  const seenToolResultIds = new Set<string>();
  const permissionRequests: PermissionRequestInfo[] = [];
  let capturedSdkSessionId: string | null = null;
  let latestAttemptedRevision = 0;
  let persistedAssistantAck: AssistantPersistedEventData | null = null;
  let persistedAssistantAckEmitted = false;

  const discardAssistantPlaceholder = () => {
    const deleted = deleteMessageRecord(assistantMessageId);
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

  const persistAssistantTerminalStateDirect = (
    terminalStatus: 'completed' | 'error',
    revision: number,
  ) => {
    const blocks = buildLiveContentBlocks();
    if (blocks.length === 0) {
      discardAssistantPlaceholder();
      return;
    }
    persistedAssistantAck = persistAssistantTerminalStateDirectToDb({
      sessionId,
      messageId: assistantMessageId,
      clientMessageId: assistantClientMessageId,
      blocks,
      tokenUsage,
      terminalStatus,
      revision,
    });
  };

  const emitPersistedAssistantAck = () => {
    if (!persistedAssistantAck || persistedAssistantAckEmitted) {
      return;
    }

    persistedAssistantAckEmitted = true;
    agentOrchestrator.handleEvent({
      type: 'message.assistant.persisted',
      metadata: createEventMetadata(sessionId, 'bridge', 'persisted'),
      clientMessageId: persistedAssistantAck.client_message_id,
      messageId: persistedAssistantAck.message_id,
      revision: persistedAssistantAck.revision,
      createdAt: persistedAssistantAck.created_at,
    });
  };

  const checkpointFlusher = createCheckpointFlusher({
    getSnapshot: buildLiveContentBlocks,
    persistSnapshot: async ({ blocks, revision, isFinal, terminalStatus }) => {
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

      persistedAssistantAck = persistAssistantTerminalStateDirectToDb({
        sessionId,
        messageId: assistantMessageId,
        clientMessageId: assistantClientMessageId,
        blocks,
        tokenUsage,
        terminalStatus,
        revision,
      });
    },
    onDegraded: (error) => {
      console.warn('[conversation-engine] checkpoint flush degraded', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const persistAssistantTerminalState = async (terminalStatus: 'completed' | 'error') => {
    if (buildLiveContentBlocks().length === 0) {
      discardAssistantPlaceholder();
      return;
    }

    await checkpointFlusher.finalize(terminalStatus);
    if (!checkpointFlusher.isDegraded()) {
      return;
    }

    persistAssistantTerminalStateDirect(
      terminalStatus,
      Math.max(latestAttemptedRevision, buildLiveContentBlocks().length > 0 ? 1 : 0),
    );
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
        if (!line.startsWith('data: ')) continue;

        let event: SSEEvent;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        const agentEvent = sdkAdapter.adaptSSEEvent(event, {
          sessionId,
          source: 'bridge',
        });
        if (agentEvent) {
          agentOrchestrator.handleEvent(agentEvent);
        }

        switch (event.type) {
          case 'text':
            if (activeBuffer === 'reasoning') {
              flushReasoningBuffer();
              checkpointFlusher.markDirty({ immediate: true });
            }
            currentText += event.data;
            activeBuffer = 'text';
            checkpointFlusher.markDirty({ textDelta: event.data.length });
            break;

          case 'reasoning':
            if (activeBuffer === 'text') {
              flushTextBuffer();
              checkpointFlusher.markDirty({ immediate: true });
            }
            currentReasoning += event.data;
            activeBuffer = 'reasoning';
            checkpointFlusher.markDirty({ textDelta: event.data.length });
            break;

          case 'tool_use': {
            flushActiveBuffer();
            try {
              const toolData = JSON.parse(event.data);
              contentBlocks.push({
                type: 'tool_use',
                id: toolData.id,
                name: toolData.name,
                input: toolData.input,
              });
              checkpointFlusher.markDirty({ immediate: true });
            } catch { /* skip */ }
            break;
          }

          case 'tool_result': {
            flushActiveBuffer();
            try {
              const resultData = JSON.parse(event.data);
              const newBlock = {
                type: 'tool_result' as const,
                tool_use_id: resultData.tool_use_id,
                content: resultData.content,
                is_error: resultData.is_error || false,
              };
              if (seenToolResultIds.has(resultData.tool_use_id)) {
                const idx = contentBlocks.findIndex(
                  (b) => b.type === 'tool_result' && 'tool_use_id' in b && b.tool_use_id === resultData.tool_use_id
                );
                if (idx >= 0) contentBlocks[idx] = newBlock;
              } else {
                seenToolResultIds.add(resultData.tool_use_id);
                contentBlocks.push(newBlock);
              }
              checkpointFlusher.markDirty({ immediate: true });
            } catch { /* skip */ }
            break;
          }

          case 'permission_request': {
            try {
              const permData = JSON.parse(event.data);
              const perm: PermissionRequestInfo = {
                permissionRequestId: permData.permissionRequestId,
                toolName: permData.toolName,
                toolInput: permData.toolInput,
                suggestions: permData.suggestions,
              };
              permissionRequests.push(perm);
              // Forward immediately — the stream blocks until the permission is
              // resolved, so we must send the IM prompt *now*, not after the stream ends.
              if (onPermissionRequest) {
                onPermissionRequest(perm).catch((err) => {
                  console.error('[conversation-engine] Failed to forward permission request:', err);
                });
              }
            } catch { /* skip */ }
            break;
          }

          case 'status': {
            try {
              const statusData = JSON.parse(event.data);
              if (statusData.session_id) {
                capturedSdkSessionId = statusData.session_id;
                sessionStateManager.updateSessionState(sessionId, { sdkSessionId: statusData.session_id });
              }
              if (statusData.model) {
                updateSessionModel(sessionId, statusData.model);
              }
            } catch { /* skip */ }
            break;
          }

          case 'task_update': {
            try {
              const taskData = JSON.parse(event.data);
              if (taskData.session_id && taskData.todos) {
                syncSdkTasks(taskData.session_id, taskData.todos);
              }
            } catch { /* skip */ }
            break;
          }

          case 'error':
            hasError = true;
            errorMessage = normalizeContextLimitErrorMessage(event.data || 'Unknown error');
            break;

          case 'result': {
            try {
              const resultData = JSON.parse(event.data);
              if (resultData.usage) tokenUsage = resultData.usage;
              if (resultData.is_error) hasError = true;
              if (resultData.session_id) {
                capturedSdkSessionId = resultData.session_id;
                sessionStateManager.updateSessionState(sessionId, { sdkSessionId: resultData.session_id });
              }
            } catch { /* skip */ }
            break;
          }

          case 'done':
            sawDoneEvent = true;
            break;

          // tool_output, tool_timeout, mode_changed, persisted — ignored for bridge
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

    flushActiveBuffer();

    await persistAssistantTerminalState(hasError ? 'error' : 'completed');
    emitPersistedAssistantAck();

    // Extract text-only response for IM delivery
    const responseText = contentBlocks
      .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return {
      responseText,
      tokenUsage,
      hasError,
      errorMessage,
      permissionRequests,
      sdkSessionId: capturedSdkSessionId,
    };
  } catch (e) {
    const normalizedError = normalizeContextLimitErrorMessage(
      e instanceof Error ? e.message : 'Stream consumption error',
    );
    agentOrchestrator.markSessionError(
      sessionId,
      normalizedError,
      'bridge',
    );
    // Best-effort save on stream error
    flushActiveBuffer();
    await persistAssistantTerminalState('error');
    emitPersistedAssistantAck();

    const isAbort = e instanceof DOMException && e.name === 'AbortError'
      || e instanceof Error && e.name === 'AbortError';

    return {
      responseText: '',
      tokenUsage,
      hasError: true,
      errorMessage: isAbort ? 'Task stopped by user' : normalizedError,
      permissionRequests,
      sdkSessionId: capturedSdkSessionId,
    };
  } finally {
    await checkpointFlusher.dispose();
  }
}
