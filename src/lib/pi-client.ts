import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getUploadedFilePaths, buildPromptWithHistory, formatSSE } from '@/lib/claude-client/message-utils';
import { isDangerouslySkipPermissionsEnabled } from '@/lib/assistant-permissions';
import { getSetting } from '@/lib/db-session';
import { getShellEnvironment } from '@/lib/environment';
import { splitPiModelSelection } from '@/lib/pi-model-selection';
import { findPiBinary, getExpandedPath } from '@/lib/platform';
import {
  createUnavailableRuntimeContextState,
  getRuntimeContextState,
  setRuntimeContextState,
  updateRuntimeContextState,
} from '@/lib/context-runtime';
import type {
  FileAttachment,
  PiStreamOptions,
  RuntimeCompactionTrigger,
  SSEEvent,
  TokenUsage,
} from '@/types';

type PiRpcRecord = {
  id?: unknown;
  type?: unknown;
  command?: unknown;
  success?: unknown;
  error?: unknown;
  data?: unknown;
  [key: string]: unknown;
};

type PiUsage = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  cost?: { total?: unknown };
};

export const piClientPlatform = {
  findPiBinary,
  dangerouslySkipPermissionsEnabled() {
    return isDangerouslySkipPermissionsEnabled(getSetting('dangerously_skip_permissions'));
  },
  spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
  ): ChildProcessWithoutNullStreams {
    return spawn(command, args, options);
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asOptionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function piCompactionTrigger(reason: unknown): RuntimeCompactionTrigger | null {
  if (reason === 'threshold') return 'auto';
  if (reason === 'overflow') return 'recovery';
  if (reason === 'manual') return 'manual';
  return null;
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const block = asRecord(item);
      return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildPiPrompt(
  prompt: string,
  history: PiStreamOptions['conversationHistory'],
  files: FileAttachment[] | undefined,
  workingDirectory: string,
): string {
  let result = buildPromptWithHistory(prompt, history);
  const nonImages = (files || []).filter((file) => !file.type.startsWith('image/'));
  if (nonImages.length === 0) return result;

  const paths = getUploadedFilePaths(nonImages, workingDirectory);
  const references = paths.map((filePath, index) => (
    `[User attached file: ${filePath} (${nonImages[index].name})]`
  ));
  result = `${references.join('\n')}\n\nPlease read the attached file(s) above, then respond to the user's message:\n\n${result}`;
  return result;
}

function buildPiImages(files?: FileAttachment[]) {
  return (files || [])
    .filter((file) => file.type.startsWith('image/') && Boolean(file.data))
    .map((file) => ({ type: 'image', data: file.data, mimeType: file.type || 'image/png' }));
}

export function parseWindowsPiShimScript(wrapper: string): string | null {
  const match = wrapper.match(/"%(?:~dp0|dp0%)\\([^"\r\n]+\.js)"/i)
    || wrapper.match(/%(?:~dp0|dp0%)\\([^"\r\n]*\.js)/i);
  return match?.[1] || null;
}

export function resolveWindowsPiNodeCommand(binary: string): string {
  const adjacentNode = path.join(path.dirname(binary), 'node.exe');
  return fs.existsSync(adjacentNode) ? adjacentNode : 'node.exe';
}

function resolvePiLaunch(binary: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(binary)) {
    return { command: binary, args };
  }

  try {
    const wrapper = fs.readFileSync(binary, 'utf8');
    const relativeScript = parseWindowsPiShimScript(wrapper);
    if (relativeScript) {
      const script = path.normalize(path.join(path.dirname(binary), relativeScript));
      if (fs.existsSync(script)) {
        return { command: resolveWindowsPiNodeCommand(binary), args: [script, ...args] };
      }
    }
  } catch {
    // Report the safe failure below rather than invoking a shell with prompt arguments.
  }

  throw new Error('Pi Windows launcher could not resolve the JavaScript entry point from its command shim');
}

function terminatePiProcess(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // best effort
  }
}

export function isPiSessionResolutionError(detail: string): boolean {
  return /(?:no session found matching|session (?:file )?not found|invalid session(?: id)?|failed to (?:find|load|open) session)/i.test(detail);
}

function toTokenUsage(usage: PiUsage): TokenUsage {
  return {
    input_tokens: asFiniteNumber(usage.input),
    output_tokens: asFiniteNumber(usage.output),
    cache_read_input_tokens: asFiniteNumber(usage.cacheRead),
    cache_creation_input_tokens: asFiniteNumber(usage.cacheWrite),
    cost_usd: asFiniteNumber(usage.cost?.total),
  };
}

export function streamPi(options: PiStreamOptions): ReadableStream<string> {
  let currentChild: ChildProcessWithoutNullStreams | null = null;
  let abortTimer: ReturnType<typeof setTimeout> | null = null;

  return new ReadableStream<string>({
    async start(controller) {
      setRuntimeContextState(
        options.sessionId,
        createUnavailableRuntimeContextState('pi'),
      );
      const binary = piClientPlatform.findPiBinary();
      if (!binary) {
        controller.enqueue(formatSSE({ type: 'error', data: 'Pi CLI is not installed' }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
        return;
      }

      let terminal = false;
      let aborted = false;
      const usage: PiUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } };
      const toolOutputById = new Map<string, string>();
      const emittedToolIds = new Set<string>();

      const emit = (event: SSEEvent) => {
        if (!terminal) controller.enqueue(formatSSE(event));
      };

      const finish = (error?: string) => {
        if (terminal) return;
        options.onRuntimeStatusChange?.('idle');
        if (error) controller.enqueue(formatSSE({ type: 'error', data: error }));
        controller.enqueue(formatSSE({ type: 'result', data: JSON.stringify({ usage: toTokenUsage(usage), is_error: Boolean(error) }) }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        terminal = true;
        controller.close();
        if (abortTimer) clearTimeout(abortTimer);
        terminatePiProcess(currentChild);
        currentChild = null;
      };

      const addUsage = (rawUsage: unknown) => {
        const next = asRecord(rawUsage) as PiUsage | null;
        if (!next) return;
        usage.input = asFiniteNumber(usage.input) + asFiniteNumber(next.input);
        usage.output = asFiniteNumber(usage.output) + asFiniteNumber(next.output);
        usage.cacheRead = asFiniteNumber(usage.cacheRead) + asFiniteNumber(next.cacheRead);
        usage.cacheWrite = asFiniteNumber(usage.cacheWrite) + asFiniteNumber(next.cacheWrite);
        usage.cost = { total: asFiniteNumber(usage.cost?.total) + asFiniteNumber(next.cost?.total) };
      };

      const beginNativeCompaction = (reason: unknown) => {
        const previous = getRuntimeContextState(options.sessionId);
        const activeCompaction = previous?.compaction.status === 'compacting'
          ? previous.compaction
          : null;
        updateRuntimeContextState(options.sessionId, 'pi', {
          compaction: {
            status: 'compacting',
            trigger: piCompactionTrigger(reason),
            preTokens: null,
            postTokens: null,
            postTokensEstimated: false,
            startedAt: activeCompaction?.startedAt ?? Date.now(),
            completedAt: null,
            error: null,
          },
        });
      };

      const endNativeCompaction = (record: PiRpcRecord) => {
        const completedAt = Date.now();
        const previous = getRuntimeContextState(options.sessionId);
        const activeCompaction = previous?.compaction.status === 'compacting'
          ? previous.compaction
          : null;
        const result = asRecord(record.result);
        const tokensBefore = asOptionalNonNegativeNumber(result?.tokensBefore);
        const estimatedTokensAfter = asOptionalNonNegativeNumber(result?.estimatedTokensAfter);
        const nativeError = typeof record.errorMessage === 'string' && record.errorMessage.trim()
          ? record.errorMessage.trim()
          : typeof record.error === 'string' && record.error.trim()
            ? record.error.trim()
            : null;
        const trigger = piCompactionTrigger(record.reason) ?? activeCompaction?.trigger ?? null;
        const failure = record.aborted === true
          ? 'Pi native compaction aborted'
          : nativeError
            ?? (!result
              ? 'Pi native compaction ended without a result'
              : tokensBefore === null
                ? 'Pi native compaction result is missing tokensBefore'
                : trigger === null
                  ? 'Pi native compaction ended without a recognized reason'
                  : null);
        const startedAt = activeCompaction?.startedAt ?? completedAt;

        if (failure || trigger === null) {
          updateRuntimeContextState(options.sessionId, 'pi', {
            compaction: {
              status: 'failed',
              trigger,
              preTokens: tokensBefore ?? activeCompaction?.preTokens ?? null,
              postTokens: null,
              postTokensEstimated: false,
              startedAt,
              completedAt,
              error: failure ?? 'Pi native compaction ended without a recognized reason',
            },
          });
          return;
        }

        updateRuntimeContextState(options.sessionId, 'pi', {
          compaction: {
            status: 'completed',
            trigger,
            preTokens: tokensBefore,
            postTokens: estimatedTokensAfter,
            postTokensEstimated: estimatedTokensAfter !== null,
            startedAt,
            completedAt,
            error: null,
          },
        });
      };

      const send = (child: ChildProcessWithoutNullStreams, command: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify(command)}\n`);
      };

      const startAttempt = async (
        resumeSessionId?: string,
        freshConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
      ): Promise<void> => {
        const args = ['--mode', 'rpc'];
        if (resumeSessionId) args.push('--session', resumeSessionId);
        const piModelSelection = splitPiModelSelection(options.model);
        if (piModelSelection.model) args.push('--model', piModelSelection.model);
        if (piModelSelection.thinkingLevel) args.push('--thinking', piModelSelection.thinkingLevel);

        let appendedSystemPrompt = options.systemPrompt?.trim() || '';
        if (options.permissionMode === 'plan') {
          args.push('--tools', 'read,grep,find,ls');
          appendedSystemPrompt = `${appendedSystemPrompt}\n\nYou are in Plan mode. Inspect and reason about the project, but do not modify files or run write-capable commands.`.trim();
        } else if (options.permissionMode === 'default') {
          args.push('--no-tools');
        } else if (!piClientPlatform.dangerouslySkipPermissionsEnabled()) {
          args.push('--tools', 'read,grep,find,ls');
          appendedSystemPrompt = `${appendedSystemPrompt}\n\nNoonFlow has dangerous permissions disabled. You may inspect the project, but you must not modify files or run write-capable commands.`.trim();
          emit({
            type: 'status',
            data: JSON.stringify({
              notification: true,
              title: 'Pi safe tools enabled',
              message: 'File writes and shell commands are disabled. Enable dangerous permissions in Settings to allow them.',
            }),
          });
        }
        if (appendedSystemPrompt) args.push('--append-system-prompt', appendedSystemPrompt);

        const shellEnv = await getShellEnvironment();
        const env = Object.fromEntries(
          Object.entries({
            ...shellEnv,
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || 'production',
            PATH: getExpandedPath(),
            PI_SKIP_VERSION_CHECK: '1',
            PI_TELEMETRY: '0',
          }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ) as NodeJS.ProcessEnv;
        const cwd = options.workingDirectory || os.homedir();
        const launch = resolvePiLaunch(binary, args);
        const child = piClientPlatform.spawn(launch.command, launch.args, {
          cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        currentChild = child;
        options.onRuntimeStatusChange?.('running');

        let stdoutBuffer = '';
        let stderrBuffer = '';
        let promptAccepted = false;
        let settled = false;

        const history = resumeSessionId
          ? undefined
          : freshConversationHistory ?? options.conversationHistory;
        const message = buildPiPrompt(options.prompt, history, options.files, cwd);
        const images = buildPiImages(options.files);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8000);
        });

        const handleRecord = (record: PiRpcRecord) => {
          const type = typeof record.type === 'string' ? record.type : '';
          if (type === 'response') {
            const id = typeof record.id === 'string' ? record.id : '';
            if (id === 'noonflow-state' && record.success === true) {
              const data = asRecord(record.data);
              const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : '';
              const model = asRecord(data?.model);
              const modelId = typeof model?.id === 'string' ? model.id : '';
              const modelProvider = typeof model?.provider === 'string' ? model.provider : '';
              const selectedModel = modelProvider && modelId ? `${modelProvider}/${modelId}` : modelId || options.model;
              if (sessionId) {
                emit({ type: 'status', data: JSON.stringify({ session_id: sessionId, ...(selectedModel ? { model: selectedModel } : {}) }) });
              }
            }
            if (id === 'noonflow-prompt') {
              if (record.success === true) {
                promptAccepted = true;
              } else {
                finish(typeof record.error === 'string' ? record.error : 'Pi rejected the prompt');
              }
            }
            return;
          }

          if (type === 'agent_start') {
            promptAccepted = true;
            emit({ type: 'status', data: 'Pi is working...' });
            return;
          }
          if (type === 'message_update') {
            const event = asRecord(record.assistantMessageEvent);
            if (event?.type === 'toolcall_end') {
              const toolCall = asRecord(event.toolCall);
              const id = typeof toolCall?.id === 'string' ? toolCall.id : '';
              if (id && !emittedToolIds.has(id)) {
                emittedToolIds.add(id);
                emit({
                  type: 'tool_use',
                  data: JSON.stringify({ id, name: toolCall?.name || 'tool', input: toolCall?.arguments || {} }),
                });
              }
              return;
            }
            const delta = typeof event?.delta === 'string' ? event.delta : '';
            if (!delta) return;
            if (event?.type === 'text_delta') emit({ type: 'text', data: delta });
            if (event?.type === 'thinking_delta') emit({ type: 'reasoning', data: delta });
            return;
          }
          if (type === 'message_end') {
            const messageRecord = asRecord(record.message);
            if (messageRecord?.role === 'assistant') {
              addUsage(messageRecord.usage);
              updateRuntimeContextState(options.sessionId, 'pi', {
                lastTurnUsage: toTokenUsage(usage),
              });
              if (messageRecord.stopReason === 'error') {
                const errorText = typeof messageRecord.errorMessage === 'string' && messageRecord.errorMessage.trim()
                  ? messageRecord.errorMessage
                  : extractTextContent(messageRecord.content) || 'Pi model request failed';
                finish(errorText);
              }
            }
            return;
          }
          if (type === 'tool_execution_start') {
            const id = typeof record.toolCallId === 'string' ? record.toolCallId : '';
            if (id && !emittedToolIds.has(id)) {
              emittedToolIds.add(id);
              emit({
                type: 'tool_use',
                data: JSON.stringify({ id, name: record.toolName || 'tool', input: record.args || {} }),
              });
            }
            return;
          }
          if (type === 'tool_execution_update') {
            const id = typeof record.toolCallId === 'string' ? record.toolCallId : '';
            const partial = asRecord(record.partialResult);
            const next = extractTextContent(partial?.content);
            const previous = toolOutputById.get(id) || '';
            const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
            toolOutputById.set(id, next);
            if (delta) emit({ type: 'tool_output', data: delta });
            return;
          }
          if (type === 'tool_execution_end') {
            const id = typeof record.toolCallId === 'string' ? record.toolCallId : '';
            const result = asRecord(record.result);
            if (id) {
              emit({
                type: 'tool_result',
                data: JSON.stringify({
                  tool_use_id: id,
                  content: extractTextContent(result?.content),
                  is_error: Boolean(record.isError),
                }),
              });
            }
            return;
          }
          if (type === 'compaction_start') {
            beginNativeCompaction(record.reason);
            emit({ type: 'status', data: 'Pi is compacting the session...' });
            return;
          }
          if (type === 'compaction_end') {
            endNativeCompaction(record);
            return;
          }
          if (type === 'auto_retry_start') {
            emit({ type: 'status', data: `Pi is retrying (attempt ${asFiniteNumber(record.attempt)})...` });
            return;
          }
          if (type === 'extension_error') {
            emit({ type: 'status', data: `Pi extension warning: ${String(record.error || 'unknown error')}` });
            return;
          }
          if (type === 'agent_settled') {
            settled = true;
            finish();
          }
        };

        child.stdout.on('data', (chunk: string) => {
          stdoutBuffer += chunk;
          const records = stdoutBuffer.split('\n');
          stdoutBuffer = records.pop() || '';
          for (const rawRecord of records) {
            const normalized = rawRecord.endsWith('\r') ? rawRecord.slice(0, -1) : rawRecord;
            if (!normalized.trim()) continue;
            try {
              handleRecord(JSON.parse(normalized) as PiRpcRecord);
            } catch {
              stderrBuffer = `${stderrBuffer}\nMalformed Pi RPC record: ${normalized.slice(0, 500)}`.slice(-8000);
            }
          }
        });

        child.on('error', (error) => {
          if (!terminal) finish(`Failed to start Pi: ${error.message}`);
        });
        child.on('close', (code) => {
          if (terminal || settled) return;
          if (aborted) {
            finish();
            return;
          }
          const detail = stderrBuffer.trim();
          if (resumeSessionId && !promptAccepted && isPiSessionResolutionError(detail)) {
            options.onSessionIdInvalidated?.();
            emit({ type: 'status', data: JSON.stringify({ notification: true, title: 'Pi session reset', message: 'Previous Pi session could not be resumed. Starting a fresh conversation.' }) });
            const reason = `native_resume_failed:${detail || 'pi_session_resolution_error'}`;
            void Promise.resolve(options.loadEmergencyConversationHistory?.(reason))
              .then((history) => startAttempt(undefined, history ?? []))
              .catch((error: unknown) => {
                finish(error instanceof Error ? error.message : String(error));
              });
            return;
          }
          finish(detail || `Pi exited before the turn settled (code ${code ?? 'unknown'})`);
        });

        send(child, { id: 'noonflow-state', type: 'get_state' });
        send(child, {
          id: 'noonflow-prompt',
          type: 'prompt',
          message,
          ...(images.length > 0 ? { images } : {}),
        });
      };

      const abort = () => {
        if (terminal || aborted) return;
        aborted = true;
        options.onRuntimeStatusChange?.('stopping');
        try {
          if (currentChild && !currentChild.killed) {
            currentChild.stdin.write(`${JSON.stringify({ type: 'abort' })}\n`);
          }
        } catch {
          // best effort
        }
        abortTimer = setTimeout(() => {
          terminatePiProcess(currentChild);
          finish();
        }, 1500);
      };
      options.abortController?.signal.addEventListener('abort', abort, { once: true });

      void startAttempt(options.sdkSessionId).catch((error: unknown) => {
        finish(error instanceof Error ? error.message : String(error));
      });
    },

    cancel() {
      if (abortTimer) clearTimeout(abortTimer);
      terminatePiProcess(currentChild);
      currentChild = null;
    },
  });
}
