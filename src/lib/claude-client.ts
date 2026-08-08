import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  Options,
  NotificationHookInput,
  PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, ContextBudgetRecoveryMetrics, PermissionRequestEvent, TokenUsage, ApiProvider } from '@/types';
import { SETTING_KEYS } from '@/types';
import { CLAUDE_AUTH_MODE_KEY, inferAssistantAuthMode } from './assistant-auth';
import { registerPendingPermission } from './permission-registry';
import { registerConversation, unregisterConversation } from './conversation-registry';
import { getSetting, getActiveProvider, createPermissionRequest } from './db';
import { findGitBash, getExpandedPath } from './platform';
import { getShellEnvironment } from './environment';
import { notifyPermissionRequest, notifyGeneric } from './telegram-bot';
import { retryStrategy, RetryableError } from './retry-strategy';
import { sessionStateManager } from './session-state-manager';
import { isContextLimitExceededError, normalizeContextLimitErrorMessage } from './context-budget';
import {
  buildFinalPrompt,
  extractTextFromMessage,
  extractTokenUsage,
  formatSSE,
} from './claude-client/message-utils';
import { findClaudePath, resolveScriptFromCmd, sanitizeEnv } from './claude-client/env';
import { toSdkMcpConfig } from './claude-client/mcp';
import { isDangerouslySkipPermissionsEnabled } from './assistant-permissions';
import os from 'os';
import fs from 'fs';
import path from 'path';

let claudeQueryImpl: typeof query = query;

// Max retry attempts when a resume session is active.
// Attempt 1: try official /compact + retry; attempt 2: retry without resume.
const MAX_RESUME_RETRIES = 2;

export function __setClaudeQueryForTests(override: typeof query | null): void {
  claudeQueryImpl = override ?? query;
}

type StreamClaudeTestOverride = (options: ClaudeStreamOptions) => ReadableStream<string>;

let streamClaudeOverrideForTests: StreamClaudeTestOverride | null = null;
const streamClaudeSessionOverridesForTests = new Map<string, StreamClaudeTestOverride>();

export function __setStreamClaudeForTests(
  override: StreamClaudeTestOverride | null,
  sessionId?: string,
): void {
  if (sessionId) {
    if (!override) {
      streamClaudeSessionOverridesForTests.delete(sessionId);
    } else {
      streamClaudeSessionOverridesForTests.set(sessionId, override);
    }
    return;
  }
  streamClaudeOverrideForTests = override;
}

export function __resetStreamClaudeTestOverrides(): void {
  streamClaudeOverrideForTests = null;
  streamClaudeSessionOverridesForTests.clear();
}

export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  const scopedOverride = options.sessionId
    ? streamClaudeSessionOverridesForTests.get(options.sessionId)
    : null;
  if (scopedOverride) {
    return scopedOverride(options);
  }
  if (streamClaudeOverrideForTests) {
    return streamClaudeOverrideForTests(options);
  }

  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    abortController,
    permissionMode,
    files,
    toolTimeoutSeconds = 0,
    conversationHistory,
    onRuntimeStatusChange,
    onContextBudgetRecovery,
    imageAgentMode,
    generativeUI,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      // Hoist variables that must be accessible in both try and catch blocks.
      const activeProvider: ApiProvider | undefined = options.provider ?? getActiveProvider();

      const emitNotificationStatus = (title: string, message: string) => {
        controller.enqueue(formatSSE({
          type: 'status',
          data: JSON.stringify({
            notification: true,
            title,
            message,
          }),
        }));
      };

      const clearResumedSession = () => {
        if (!sessionId) {
          return;
        }
        try { sessionStateManager.updateSessionState(sessionId, { sdkSessionId: '' }); } catch { /* best effort */ }
      };

      const recoveryMetrics: Required<ContextBudgetRecoveryMetrics> = {
        officialCompactAttempted: false,
        officialCompactSuccess: false,
        compactRetrySuccess: false,
        recoveryDurationMs: null,
      };

      try {
        const persistRecoveryMetrics = async (patch: ContextBudgetRecoveryMetrics) => {
          if (patch.officialCompactAttempted !== undefined) {
            recoveryMetrics.officialCompactAttempted = recoveryMetrics.officialCompactAttempted || patch.officialCompactAttempted;
          }
          if (patch.officialCompactSuccess !== undefined) {
            recoveryMetrics.officialCompactSuccess = recoveryMetrics.officialCompactSuccess || patch.officialCompactSuccess;
          }
          if (patch.compactRetrySuccess !== undefined) {
            recoveryMetrics.compactRetrySuccess = recoveryMetrics.compactRetrySuccess || patch.compactRetrySuccess;
          }
          if (patch.recoveryDurationMs !== undefined) {
            recoveryMetrics.recoveryDurationMs = patch.recoveryDurationMs;
          }

          if (!onContextBudgetRecovery) {
            return;
          }

          try {
            await onContextBudgetRecovery({ ...recoveryMetrics });
          } catch (error) {
            console.warn('[claude-client] Failed to persist context budget recovery metrics:', error);
          }
        };

        // Build env for the Claude Code subprocess.
        // Start with shell environment (includes user's .zshrc/.bash_profile settings).
        // Then overlay any API config the user set in NoonFlow settings (optional).
        const shellEnv = await getShellEnvironment();
        const sdkEnv: Record<string, string> = { ...shellEnv };

        // Ensure HOME/USERPROFILE are set so Claude Code can find ~/.claude/commands/
        if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir();
        if (!sdkEnv.USERPROFILE) sdkEnv.USERPROFILE = os.homedir();
        // Ensure SDK subprocess has expanded PATH (consistent with desktop runtime behavior)
        sdkEnv.PATH = sdkEnv.PATH || getExpandedPath();

        // Remove CLAUDECODE env var to prevent "nested session" detection.
        // When NoonFlow is launched from within a Claude Code CLI session
        // (e.g. during development), the child process inherits this variable
        // and the SDK refuses to start.
        delete sdkEnv.CLAUDECODE;

        // On Windows, auto-detect Git Bash if not already configured
        if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
          const gitBashPath = findGitBash();
          if (gitBashPath) {
            sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
          }
        }

        if (activeProvider && activeProvider.api_key) {
          // Clear all existing ANTHROPIC_* variables to prevent conflicts
          for (const key of Object.keys(sdkEnv)) {
            if (key.startsWith('ANTHROPIC_')) {
              delete sdkEnv[key];
            }
          }

          // Inject provider config — set both token variants so extra_env can clear the unwanted one
          sdkEnv.ANTHROPIC_AUTH_TOKEN = activeProvider.api_key;
          sdkEnv.ANTHROPIC_API_KEY = activeProvider.api_key;
          if (activeProvider.base_url) {
            sdkEnv.ANTHROPIC_BASE_URL = activeProvider.base_url;
          }

          // Inject extra environment variables
          // Empty string values mean "delete this variable" (e.g. clear ANTHROPIC_API_KEY for AUTH_TOKEN-only providers)
          try {
            const extraEnv = JSON.parse(activeProvider.extra_env || '{}');
            for (const [key, value] of Object.entries(extraEnv)) {
              if (typeof value === 'string') {
                if (value === '') {
                  delete sdkEnv[key];
                } else {
                  sdkEnv[key] = value;
                }
              }
            }
          } catch {
            // ignore malformed extra_env
          }
        } else {
          // No active provider — check legacy DB settings first, then fall back to
          // environment variables already present in process.env (copied into sdkEnv above),
          // unless the user explicitly selected CLI login mode.
          const appToken = getSetting('anthropic_auth_token');
          const appBaseUrl = getSetting('anthropic_base_url');
          const authMode = inferAssistantAuthMode({
            storedMode: getSetting(CLAUDE_AUTH_MODE_KEY),
            storedToken: appToken,
            storedBaseUrl: appBaseUrl,
            envToken: sdkEnv.ANTHROPIC_API_KEY || sdkEnv.ANTHROPIC_AUTH_TOKEN,
            envBaseUrl: sdkEnv.ANTHROPIC_BASE_URL,
          });

          if (authMode === 'login') {
            delete sdkEnv.ANTHROPIC_API_KEY;
            delete sdkEnv.ANTHROPIC_AUTH_TOKEN;
            delete sdkEnv.ANTHROPIC_BASE_URL;
          } else {
            if (appToken) {
              sdkEnv.ANTHROPIC_AUTH_TOKEN = appToken;
              sdkEnv.ANTHROPIC_API_KEY = appToken;
            }
            if (appBaseUrl) {
              sdkEnv.ANTHROPIC_BASE_URL = appBaseUrl;
            }
          }

          if (
            authMode !== 'login'
            && !appToken
            && !sdkEnv.ANTHROPIC_API_KEY
            && !sdkEnv.ANTHROPIC_AUTH_TOKEN
          ) {
            console.warn('[claude-client] No API key found: no active provider, no legacy settings, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
          }
        }

        // Check if dangerously_skip_permissions is enabled in app settings
        const skipPermissions = isDangerouslySkipPermissionsEnabled(getSetting('dangerously_skip_permissions'));
        const reasoningEnabled = getSetting(SETTING_KEYS.CHAT_REASONING_ENABLED) === 'true';
        const maxThinkingTokens = Number.parseInt(getSetting(SETTING_KEYS.MAX_THINKING_TOKENS) || '', 10);

        const queryOptions: Options = {
          cwd: workingDirectory || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode: skipPermissions
            ? 'bypassPermissions'
            : ((permissionMode as Options['permissionMode']) || 'acceptEdits'),
          env: sanitizeEnv(sdkEnv),
          // Always load user settings to ensure skills are available.
          // User-level skills are stored in ~/.claude/plugins/ and referenced
          // via ~/.claude/settings.json. Without 'user' in settingSources,
          // these skills won't be loaded.
          // Note: Environment variables from activeProvider take precedence
          // over those in settings.json due to how sdkEnv is constructed above.
          settingSources: ['user', 'project', 'local'],
        };

        queryOptions.thinking = reasoningEnabled
          ? (
              Number.isFinite(maxThinkingTokens) && maxThinkingTokens > 0
                ? { type: 'enabled', budgetTokens: maxThinkingTokens }
                : { type: 'adaptive' }
            )
          : { type: 'disabled' };

        if (skipPermissions) {
          queryOptions.allowDangerouslySkipPermissions = true;
        }

        // Find claude binary for packaged app where PATH is limited.
        // On Windows, npm installs Claude CLI as a .cmd wrapper which cannot
        // be spawned directly without shell:true. Parse the wrapper to
        // extract the real .js script path and pass that to the SDK instead.
        const claudePath = findClaudePath();
        if (claudePath) {
          const ext = path.extname(claudePath).toLowerCase();
          if (ext === '.cmd' || ext === '.bat') {
            const scriptPath = resolveScriptFromCmd(claudePath);
            if (scriptPath) {
              queryOptions.pathToClaudeCodeExecutable = scriptPath;
            } else {
              console.warn('[claude-client] Could not resolve .js path from .cmd wrapper, falling back to SDK resolution:', claudePath);
            }
          } else {
            queryOptions.pathToClaudeCodeExecutable = claudePath;
          }
        }

        if (model) {
          queryOptions.model = model;
        }

        // Always use Claude Code preset to enable skills and other CLI features.
        // If a custom systemPrompt is provided, append it to the preset.
        queryOptions.systemPrompt = systemPrompt
          ? {
              type: 'preset',
              preset: 'claude_code',
              append: systemPrompt,
            }
          : {
              type: 'preset',
              preset: 'claude_code',
            };

        if (generativeUI) {
          console.info('[claude-client] generative-ui prompt enabled for this turn');
        }

        // MCP servers: only pass explicitly provided config (e.g. from NoonFlow UI).
        // User-level MCP config from ~/.claude.json and ~/.claude/settings.json
        // is now automatically loaded by the SDK via settingSources: ['user', 'project', 'local'].
        if (mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
        }

        // Resume session if we have an SDK session ID from a previous conversation turn.
        // Pre-check: verify working_directory exists before attempting resume.
        // Resume depends on session context (cwd/project scope), so if the
        // original working_directory no longer exists, resume will fail.
        let shouldResume = !!sdkSessionId;
        if (shouldResume && workingDirectory && !fs.existsSync(workingDirectory)) {
          console.warn(`[claude-client] Working directory "${workingDirectory}" does not exist, skipping resume`);
          shouldResume = false;
          clearResumedSession();
          emitNotificationStatus(
            'Session fallback',
            'Original working directory no longer exists. Starting fresh conversation.',
          );
        }
        if (shouldResume) {
          queryOptions.resume = sdkSessionId;
        }

        // Permission handler: sends SSE event and waits for user response
        queryOptions.canUseTool = async (toolName, input, opts) => {
          const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            permissionRequestId,
            toolName,
            toolInput: input,
            suggestions: opts.suggestions as PermissionRequestEvent['suggestions'],
            decisionReason: opts.decisionReason,
            blockedPath: opts.blockedPath,
            toolUseId: opts.toolUseID,
            description: undefined,
          };

          // Persist permission request to DB for audit/recovery
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
          try {
            createPermissionRequest({
              id: permissionRequestId,
              sessionId,
              sdkSessionId: sdkSessionId || '',
              toolName,
              toolInput: JSON.stringify(input),
              decisionReason: opts.decisionReason || '',
              expiresAt,
            });
          } catch (e) {
            console.warn('[claude-client] Failed to persist permission request to DB:', e);
          }

          // Send permission_request SSE event to the client
          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Notify via Telegram (fire-and-forget)
          notifyPermissionRequest(toolName, input as Record<string, unknown>, telegramOpts).catch(() => {});

          // Notify runtime status change
          if (sessionId) {
            try { sessionStateManager.updateSessionState(sessionId, { runtimeStatus: 'waiting_permission' }); } catch { /* best effort */ }
          }
          onRuntimeStatusChange?.('waiting_permission');

          // Wait for user response (resolved by POST /api/chat/permission)
          // Store original input so registry can inject updatedInput on allow
          const result = await registerPendingPermission(permissionRequestId, input, opts.signal);

          // Restore runtime status after permission resolved
          if (sessionId) {
            try { sessionStateManager.updateSessionState(sessionId, { runtimeStatus: 'running' }); } catch { /* best effort */ }
          }
          onRuntimeStatusChange?.('running');

          return result;
        };

        // Telegram notification context for hooks
        const telegramOpts = {
          sessionId,
          sessionTitle: undefined as string | undefined,
          workingDirectory,
        };

        // Hooks: capture notifications and tool completion events
        queryOptions.hooks = {
          Notification: [{
            hooks: [async (input) => {
              const notif = input as NotificationHookInput;
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  notification: true,
                  title: notif.title,
                  message: notif.message,
                }),
              }));
              // Forward to Telegram (fire-and-forget)
              notifyGeneric(notif.title || '', notif.message || '', telegramOpts).catch(() => {});
              return {};
            }],
          }],
          PostToolUse: [{
            hooks: [async (input) => {
              const toolEvent = input as PostToolUseHookInput;
              console.log('[claude-client] PostToolUse:', toolEvent.tool_name, 'id:', toolEvent.tool_use_id);
              controller.enqueue(formatSSE({
                type: 'tool_result',
                data: JSON.stringify({
                  tool_use_id: toolEvent.tool_use_id,
                  content: typeof toolEvent.tool_response === 'string'
                    ? toolEvent.tool_response
                    : JSON.stringify(toolEvent.tool_response),
                  is_error: false,
                }),
              }));

              // Detect TodoWrite tool and emit task_update SSE for frontend sync
              if (toolEvent.tool_name === 'TodoWrite') {
                try {
                  // SDK TodoWriteInput: { todos: { content, status, activeForm }[] }
                  const toolInput = toolEvent.tool_input as {
                    todos?: Array<{ content: string; status: string; activeForm?: string }>;
                  };
                  if (toolInput?.todos && Array.isArray(toolInput.todos)) {
                    console.log('[claude-client] TodoWrite detected, syncing', toolInput.todos.length, 'tasks');
                    controller.enqueue(formatSSE({
                      type: 'task_update',
                      data: JSON.stringify({
                        session_id: sessionId,
                        todos: toolInput.todos.map((t, i) => ({
                          id: String(i),
                          content: t.content,
                          status: t.status,
                          activeForm: t.activeForm || '',
                        })),
                      }),
                    }));
                  }
                } catch (e) {
                  console.warn('[claude-client] Failed to parse TodoWrite input:', e);
                }
              }

              return {};
            }],
          }],
        };

        // Capture real-time stderr output from Claude Code process
        queryOptions.stderr = (data: string) => {
          // Diagnostic: log raw stderr data length to server console
          console.log(`[stderr] received ${data.length} bytes, first 200 chars:`, data.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '?'));
          // Strip ANSI escape codes, OSC sequences, and control characters
          // but preserve tabs (\x09) and carriage returns (\x0D)
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
            .replace(/\x1B\([A-Z]/g, '')               // Character set selection
            .replace(/\x1B[=>]/g, '')                   // Keypad mode
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
            .replace(/\r\n/g, '\n')                    // Normalize CRLF
            .replace(/\r/g, '\n')                      // Convert remaining CR to LF
            .replace(/\n{3,}/g, '\n\n')                // Collapse multiple blank lines
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: cleaned,
            }));
          }
        };

        let compactRetryActive = false;
        let recoveryStartedAt: number | null = null;

        const runOfficialCompact = async (resumeSessionId: string): Promise<void> => {
          recoveryStartedAt ??= Date.now();
          await persistRecoveryMetrics({ officialCompactAttempted: true });
          emitNotificationStatus(
            '正在压缩上下文',
            '检测到 Claude resume 会话上下文超限，系统正在执行官方 /compact。',
          );

          const compactOptions: Options = {
            ...queryOptions,
            resume: resumeSessionId,
            includePartialMessages: false,
            canUseTool: undefined,
            hooks: undefined,
            stderr: undefined,
          };

          const compactConversation = claudeQueryImpl({
            prompt: '/compact',
            options: compactOptions,
          });

          for await (const compactMessage of compactConversation) {
            if (abortController?.signal.aborted) {
              throw new Error('Official /compact aborted');
            }

            if (compactMessage.type === 'result') {
              const resultMessage = compactMessage as SDKResultMessage;
              if (resultMessage.is_error) {
                const resultText = (resultMessage as SDKResultSuccess).result;
                throw new Error(resultText || 'Official /compact failed');
              }
            }
          }

          await persistRecoveryMetrics({
            officialCompactAttempted: true,
            officialCompactSuccess: true,
          });
          compactRetryActive = true;

          console.info('[claude-client] Official /compact completed', { sessionId, resumeSessionId });
          emitNotificationStatus(
            '上下文压缩完成',
            '官方 /compact 已完成，系统正在重试当前请求。',
          );
        };

        const buildConversation = async (): Promise<ReturnType<typeof query>> => {
          const promptPayload = buildFinalPrompt({
            prompt,
            useHistory: !queryOptions.resume,
            conversationHistory,
            files,
            workingDirectory,
            imageAgentMode,
            sdkSessionId,
          });
          let conversation = claudeQueryImpl({
            prompt: promptPayload,
            options: queryOptions,
          });

          if (!queryOptions.resume) {
            return conversation;
          }

          try {
            const iter = conversation[Symbol.asyncIterator]();
            const first = await iter.next();
            conversation = (async function* () {
              if (!first.done) yield first.value;
              while (true) {
                const next = await iter.next();
                if (next.done) break;
                yield next.value;
              }
            })() as ReturnType<typeof query>;
            return conversation;
          } catch (resumeError) {
            throw new RetryableError('Resume failed', { cause: resumeError });
          }
        };

        const hadResume = Boolean(queryOptions.resume);
        const conversation = await retryStrategy.executeWithRetry(
          buildConversation,
          {
            maxRetries: hadResume ? MAX_RESUME_RETRIES : 0,
            backoff: 'linear',
            baseDelayMs: 150,
            shouldRetry: (error, attempt) => hadResume && attempt <= MAX_RESUME_RETRIES && error instanceof RetryableError,
            onRetry: async (attempt, error) => {
              const errMsg = error instanceof RetryableError && error.cause instanceof Error
                ? error.cause.message
                : error instanceof Error
                  ? error.message
                  : String(error);

              if (attempt === 1 && queryOptions.resume && isContextLimitExceededError(errMsg)) {
                try {
                  await runOfficialCompact(queryOptions.resume);
                  return;
                } catch (compactError) {
                  compactRetryActive = false;
                  console.warn('[claude-client] Official /compact failed, retrying without resume:', compactError instanceof Error ? compactError.message : String(compactError));
                  clearResumedSession();
                  emitNotificationStatus(
                    'Session fallback',
                    '官方 /compact 失败，系统将启动新的对话继续当前请求。',
                  );
                  delete queryOptions.resume;
                  return;
                }
              }

              compactRetryActive = false;
              console.warn('[claude-client] Resume failed, retrying without resume:', errMsg);
              clearResumedSession();
              emitNotificationStatus(
                'Session fallback',
                attempt === 2
                  ? '官方 /compact 后仍无法恢复原会话，系统将启动新的对话继续当前请求。'
                  : 'Previous session could not be resumed. Starting fresh conversation.',
              );
              delete queryOptions.resume;
            },
          },
        );

        registerConversation(sessionId, conversation);

        let tokenUsage: TokenUsage | null = null;
        const blockTypeByIndex = new Map<number, string>();

        for await (const message of conversation) {
          if (abortController?.signal.aborted) {
            break;
          }

          switch (message.type) {
            case 'assistant': {
              const assistantMsg = message as SDKAssistantMessage;
              // Text deltas are handled by stream_event for real-time streaming.
              // Only process tool_use blocks here.
              const text = extractTextFromMessage(assistantMsg);
              void text;

              // Check for tool use blocks
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
                  controller.enqueue(formatSSE({
                    type: 'tool_use',
                    data: JSON.stringify({
                      id: block.id,
                      name: block.name,
                      input: block.input,
                    }),
                  }));
                }
              }
              break;
            }

            case 'user': {
              // Tool execution results come back as user messages with tool_result blocks
              const userMsg = message as SDKUserMessage;
              const content = userMsg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultContent = typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter((c: { type: string }) => c.type === 'text')
                            .map((c: { text: string }) => c.text)
                            .join('\n')
                        : String(block.content ?? '');
                    controller.enqueue(formatSSE({
                      type: 'tool_result',
                      data: JSON.stringify({
                        tool_use_id: block.tool_use_id,
                        content: resultContent,
                        is_error: block.is_error || false,
                      }),
                    }));
                  }
                }
              }
              break;
            }

            case 'stream_event': {
              const streamEvent = message as SDKPartialAssistantMessage;
              const evt = streamEvent.event as {
                type?: string;
                index?: number;
                delta?: { type?: string; text?: string; thinking?: string };
                content_block?: { type?: string; text?: string; thinking?: string };
              };
              if (evt.type === 'content_block_start') {
                if (typeof evt.index === 'number' && evt.content_block?.type) {
                  blockTypeByIndex.set(evt.index, evt.content_block.type);
                }
                if (evt.content_block?.type === 'thinking') {
                  const initialThinking = evt.content_block.thinking || evt.content_block.text;
                  if (initialThinking) {
                    controller.enqueue(formatSSE({ type: 'reasoning', data: initialThinking }));
                  }
                }
              } else if (evt.type === 'content_block_delta' && evt.delta) {
                const blockType = typeof evt.index === 'number' ? blockTypeByIndex.get(evt.index) : undefined;
                const isThinkingBlock = blockType === 'thinking' || evt.delta.type === 'thinking_delta';

                if (evt.delta.thinking) {
                  controller.enqueue(formatSSE({ type: 'reasoning', data: evt.delta.thinking }));
                }

                if (evt.delta.text) {
                  controller.enqueue(formatSSE({
                    type: isThinkingBlock ? 'reasoning' : 'text',
                    data: evt.delta.text,
                  }));
                }
              } else if (evt.type === 'content_block_stop' && typeof evt.index === 'number') {
                blockTypeByIndex.delete(evt.index);
              }
              break;
            }

            case 'system': {
              const sysMsg = message as SDKSystemMessage;
              if ('subtype' in sysMsg) {
                if (sysMsg.subtype === 'init') {
                  controller.enqueue(formatSSE({
                    type: 'status',
                    data: JSON.stringify({
                      session_id: sysMsg.session_id,
                      model: sysMsg.model,
                      tools: sysMsg.tools,
                    }),
                  }));
                } else if (sysMsg.subtype === 'status') {
                  const statusMsg = sysMsg as SDKSystemMessage & {
                    status?: 'compacting' | null;
                    permissionMode?: string;
                  };
                  if (statusMsg.status === 'compacting') {
                    emitNotificationStatus(
                      '正在压缩上下文',
                      'Claude 正在执行官方 /compact。',
                    );
                  }
                  // SDK sends status messages when permission mode changes (e.g. ExitPlanMode)
                  if (statusMsg.permissionMode) {
                    controller.enqueue(formatSSE({
                      type: 'mode_changed',
                      data: statusMsg.permissionMode,
                    }));
                  }
                } else if (sysMsg.subtype === 'compact_boundary') {
                  emitNotificationStatus(
                    '上下文压缩完成',
                    'Claude 已完成官方 /compact。',
                  );
                }
              }
              break;
            }

            case 'tool_progress': {
              const progressMsg = message as SDKToolProgressMessage;
              controller.enqueue(formatSSE({
                type: 'tool_output',
                data: JSON.stringify({
                  _progress: true,
                  tool_use_id: progressMsg.tool_use_id,
                  tool_name: progressMsg.tool_name,
                  elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                }),
              }));
              // Auto-timeout: abort if tool runs longer than configured threshold
              if (toolTimeoutSeconds > 0 && progressMsg.elapsed_time_seconds >= toolTimeoutSeconds) {
                controller.enqueue(formatSSE({
                  type: 'tool_timeout',
                  data: JSON.stringify({
                    tool_name: progressMsg.tool_name,
                    elapsed_seconds: Math.round(progressMsg.elapsed_time_seconds),
                  }),
                }));
                abortController?.abort();
              }
              break;
            }

            case 'result': {
              const resultMsg = message as SDKResultMessage;
              tokenUsage = extractTokenUsage(resultMsg);
              controller.enqueue(formatSSE({
                type: 'result',
                data: JSON.stringify({
                  subtype: resultMsg.subtype,
                  is_error: resultMsg.is_error,
                  num_turns: resultMsg.num_turns,
                  duration_ms: resultMsg.duration_ms,
                  usage: tokenUsage,
                  session_id: resultMsg.session_id,
                }),
              }));
              break;
            }
          }
        }

        if (compactRetryActive) {
          await persistRecoveryMetrics({
            officialCompactAttempted: true,
            officialCompactSuccess: true,
            compactRetrySuccess: true,
            recoveryDurationMs: recoveryStartedAt !== null ? Date.now() - recoveryStartedAt : null,
          });
        }

        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : 'Unknown error';
        // Log full error details for debugging (visible in terminal / dev tools)
        console.error('[claude-client] Stream error:', {
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
          stderr: error instanceof Error ? (error as { stderr?: string }).stderr : undefined,
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
        });

        // Try to extract stderr or cause for more useful error messages
        const stderr = error instanceof Error ? (error as { stderr?: string }).stderr : undefined;
        const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
        const extraDetail = stderr || (cause instanceof Error ? cause.message : cause ? String(cause) : '');

        let errorMessage = normalizeContextLimitErrorMessage(rawMessage);

        if (recoveryMetrics.officialCompactAttempted && isContextLimitExceededError(rawMessage)) {
          errorMessage = recoveryMetrics.officialCompactSuccess
            ? [
                '本轮上下文仍然超出限制。',
                '系统已自动执行官方 `/compact`，但重试当前请求仍未恢复。',
                '建议：进一步缩小输入为“目标 + 文件路径 + 必要片段（<=200 行）”，或新开会话继续。',
              ].join('\n')
            : [
                '本轮上下文超出限制。',
                '系统已自动尝试官方 `/compact`，但执行失败，未能恢复当前请求。',
                '建议：先手动执行 `/compact` 或新开会话继续，并减少本轮输入体积。',
              ].join('\n');
        }

        // Provide more specific error messages based on error type
        if (errorMessage === rawMessage && error instanceof Error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || rawMessage.includes('ENOENT') || rawMessage.includes('spawn')) {
            errorMessage = `Claude Code CLI not found. Please ensure Claude Code is installed and available in your PATH.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('exited with code 1') || rawMessage.includes('exit code 1')) {
            const providerHint = activeProvider?.name ? ` (Provider: ${activeProvider.name})` : '';
            const detailHint = extraDetail ? `\n\nDetails: ${extraDetail}` : '';
            errorMessage = `Claude Code process exited with an error${providerHint}. This is often caused by:\n• Invalid or missing API Key\n• Incorrect Base URL configuration\n• Network connectivity issues${detailHint}\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('exited with code')) {
            const providerHint = activeProvider?.name ? ` (Provider: ${activeProvider.name})` : '';
            errorMessage = `Claude Code process crashed unexpectedly${providerHint}.\n\nOriginal error: ${rawMessage}`;
          } else if (code === 'ECONNREFUSED' || rawMessage.includes('ECONNREFUSED') || rawMessage.includes('fetch failed')) {
            const baseUrl = activeProvider?.base_url || 'default';
            errorMessage = `Cannot connect to API endpoint (${baseUrl}). Please check your network connection and Base URL configuration.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized') || rawMessage.includes('authentication')) {
            const providerHint = activeProvider?.name ? ` for provider "${activeProvider.name}"` : '';
            errorMessage = `Authentication failed${providerHint}. Please verify your API Key is correct and has not expired.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('403') || rawMessage.includes('Forbidden')) {
            errorMessage = `Access denied. Your API Key may not have permission for this operation.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('429') || rawMessage.includes('rate limit') || rawMessage.includes('Rate limit')) {
            errorMessage = `Rate limit exceeded. Please wait a moment before retrying.\n\nOriginal error: ${rawMessage}`;
          }
        }

        controller.enqueue(formatSSE({ type: 'error', data: errorMessage }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));

        // If we were resuming a session and it crashed mid-stream, clear the
        // stale sdk_session_id so the next message starts a fresh SDK session
        // instead of repeatedly hitting the same broken resume.
        if (sdkSessionId && sessionId) {
          try {
            clearResumedSession();
            console.warn('[claude-client] Cleared stale sdk_session_id for session', sessionId);
          } catch {
            // best effort
          }
        }

        controller.close();
      } finally {
        unregisterConversation(sessionId);
      }
    },

    cancel() {
      abortController?.abort();
    },
  });
}
