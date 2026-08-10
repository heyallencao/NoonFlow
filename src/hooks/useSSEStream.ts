import { useRef, useCallback } from 'react';
import { agentEventBus } from '@/lib/agent-runtime/event-bus';
import type { AgentEvent, AgentEventSource } from '@/lib/agent-runtime/event-types';
import { sdkAdapter } from '@/lib/agent-runtime/sdk-adapter';
import { getChatRolloutMode } from '@/lib/chat-rollout';
import type {
  AssistantPersistedEventData,
  ChildActivity,
  PermissionRequestEvent,
  SSEEvent,
  TokenUsage,
  UserPersistedEventData,
} from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AssistantAttemptCheckpoint {
  text: string;
  reasoning: string;
}

interface StreamAccumulators {
  text: string;
  reasoning: string;
  assistantAttemptCheckpoint: AssistantAttemptCheckpoint | null;
}

export interface SSECallbacks {
  onText: (accumulated: string) => void;
  onReasoning: (accumulated: string) => void;
  onAssistantAttemptStart?: () => void;
  onAssistantAttemptReset?: (checkpoint: AssistantAttemptCheckpoint) => void;
  onToolUse: (tool: ToolUseInfo) => void;
  onToolResult: (result: ToolResultInfo) => void;
  onToolOutput: (data: string) => void;
  onToolProgress: (toolName: string, elapsedSeconds: number) => void;
  onStatus: (text: string | undefined) => void;
  onResult: (usage: TokenUsage | null) => void;
  onPermissionRequest: (data: PermissionRequestEvent) => void;
  onToolTimeout: (toolName: string, elapsedSeconds: number) => void;
  onModeChanged: (mode: string) => void;
  onTaskUpdate: (sessionId: string) => void;
  onUserPersisted: (data: UserPersistedEventData) => void;
  onAssistantPersisted: (data: AssistantPersistedEventData) => void;
  onActivity?: (activity: ChildActivity) => void;
  onHeartbeat?: () => void;
  onError: (accumulated: string, detail?: string) => void;
}

export interface ConsumeSSEStreamOptions {
  sessionId?: string;
  source?: AgentEventSource;
  emitToEventBus?: boolean;
  // Defaults to false. Enable only for explicitly legacy callers.
  allowLegacyFallback?: boolean;
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatModelFailureMessage(detail?: string): string {
  const normalizedDetail = (detail || '').trim();
  if (!normalizedDetail) {
    return '模型有问题，调用失败，请稍后重试。';
  }
  return `模型有问题，调用失败，请稍后重试。\n\n错误详情：${normalizedDetail}`;
}

function deriveSessionId(event: SSEEvent, fallbackSessionId?: string): string | undefined {
  if (fallbackSessionId) {
    return fallbackSessionId;
  }

  if (
    event.type === 'status'
    || event.type === 'result'
    || event.type === 'task_update'
    || event.type === 'user_persisted'
    || event.type === 'persisted'
  ) {
    try {
      const payload = JSON.parse(event.data) as { session_id?: string };
      if (payload.session_id) {
        return payload.session_id;
      }
    } catch {
      return fallbackSessionId;
    }
  }

  return fallbackSessionId;
}

function dispatchAgentEvent(
  event: AgentEvent,
  accumulators: StreamAccumulators,
  callbacks: SSECallbacks,
): StreamAccumulators {
  switch (event.type) {
    case 'message.delta': {
      const next = accumulators.text + event.content;
      callbacks.onText(next);
      return { ...accumulators, text: next };
    }

    case 'message.reasoning': {
      const next = accumulators.reasoning + event.content;
      callbacks.onReasoning(next);
      return { ...accumulators, reasoning: next };
    }

    case 'message.attempt.started': {
      callbacks.onAssistantAttemptStart?.();
      return {
        ...accumulators,
        assistantAttemptCheckpoint: {
          text: accumulators.text,
          reasoning: accumulators.reasoning,
        },
      };
    }

    case 'message.attempt.reset': {
      const checkpoint = accumulators.assistantAttemptCheckpoint;
      if (!checkpoint) return accumulators;
      callbacks.onAssistantAttemptReset?.(checkpoint);
      return {
        text: checkpoint.text,
        reasoning: checkpoint.reasoning,
        assistantAttemptCheckpoint: null,
      };
    }

    case 'tool.start': {
      callbacks.onToolUse({
        id: event.toolUseId,
        name: event.toolName,
        input: event.input,
      });
      return accumulators;
    }

    case 'tool.result': {
      callbacks.onToolResult({
        tool_use_id: event.toolUseId,
        content: stringifyOutput(event.output),
        is_error: event.isError,
      });
      return accumulators;
    }

    case 'tool.output': {
      callbacks.onToolOutput(event.content);
      return accumulators;
    }

    case 'tool.progress': {
      callbacks.onToolProgress(event.toolName, event.elapsedSeconds);
      return accumulators;
    }

    case 'tool.timeout': {
      callbacks.onToolTimeout(event.toolName, event.elapsedSeconds);
      return accumulators;
    }

    case 'status.updated': {
      callbacks.onStatus(event.status || event.detail);
      return accumulators;
    }

    case 'session.started': {
      callbacks.onStatus(`Connected (${event.model || 'claude'})`);
      return accumulators;
    }

    case 'session.result': {
      callbacks.onResult(event.usage);
      callbacks.onStatus(undefined);
      return accumulators;
    }

    case 'permission.required': {
      callbacks.onPermissionRequest(event.request);
      return accumulators;
    }

    case 'permission.resolved': {
      callbacks.onStatus(event.approved ? 'Permission approved' : 'Permission denied');
      return accumulators;
    }

    case 'mode.changed': {
      callbacks.onModeChanged(event.mode);
      return accumulators;
    }

    case 'tasks.updated': {
      callbacks.onTaskUpdate(event.metadata.sessionId);
      return accumulators;
    }

    case 'message.assistant.persisted': {
      callbacks.onAssistantPersisted({
        session_id: event.metadata.sessionId,
        client_message_id: event.clientMessageId,
        message_id: event.messageId,
        revision: event.revision,
        created_at: event.createdAt,
      });
      return accumulators;
    }

    case 'message.user.persisted': {
      callbacks.onUserPersisted({
        session_id: event.metadata.sessionId,
        client_message_id: event.clientMessageId,
        message_id: event.messageId,
        created_at: event.createdAt,
      });
      return accumulators;
    }

    case 'activity.updated': {
      callbacks.onActivity?.(event.activity);
      return accumulators;
    }

    case 'runtime.heartbeat': {
      callbacks.onHeartbeat?.();
      return accumulators;
    }

    case 'session.error': {
      const prefix = accumulators.text ? `${accumulators.text}\n\n` : '';
      const next = prefix + formatModelFailureMessage(event.error);
      callbacks.onError(next, event.error);
      return { ...accumulators, text: next };
    }

    case 'session.completed':
      return accumulators;

    default:
      return accumulators;
  }
}

function handleSSEEvent(
  event: SSEEvent,
  accumulators: StreamAccumulators,
  callbacks: SSECallbacks,
): StreamAccumulators {
  switch (event.type) {
    case 'text': {
      const next = accumulators.text + event.data;
      callbacks.onText(next);
      return { ...accumulators, text: next };
    }

    case 'reasoning': {
      const next = accumulators.reasoning + event.data;
      callbacks.onReasoning(next);
      return { ...accumulators, reasoning: next };
    }

    case 'assistant_attempt_start': {
      callbacks.onAssistantAttemptStart?.();
      return {
        ...accumulators,
        assistantAttemptCheckpoint: {
          text: accumulators.text,
          reasoning: accumulators.reasoning,
        },
      };
    }

    case 'assistant_attempt_reset': {
      const checkpoint = accumulators.assistantAttemptCheckpoint;
      if (!checkpoint) return accumulators;
      callbacks.onAssistantAttemptReset?.(checkpoint);
      return {
        text: checkpoint.text,
        reasoning: checkpoint.reasoning,
        assistantAttemptCheckpoint: null,
      };
    }

    case 'tool_use': {
      try {
        const toolData = JSON.parse(event.data);
        callbacks.onToolUse({
          id: toolData.id,
          name: toolData.name,
          input: toolData.input,
        });
      } catch {
        // skip malformed tool_use data
      }
      return accumulators;
    }

    case 'tool_result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onToolResult({
          tool_use_id: resultData.tool_use_id,
          content: resultData.content,
          is_error: resultData.is_error,
        });
      } catch {
        // skip malformed tool_result data
      }
      return accumulators;
    }

    case 'tool_output': {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed._progress) {
          callbacks.onToolProgress(parsed.tool_name, Math.round(parsed.elapsed_time_seconds));
          return accumulators;
        }
      } catch {
        // Not JSON - raw stderr output, fall through
      }
      callbacks.onToolOutput(event.data);
      return accumulators;
    }

    case 'status': {
      try {
        const statusData = JSON.parse(event.data);
        if (statusData.session_id) {
          callbacks.onStatus(`Connected (${statusData.model || 'claude'})`);
        } else if (statusData.notification) {
          callbacks.onStatus(statusData.message || statusData.title || undefined);
        } else {
          callbacks.onStatus(typeof event.data === 'string' ? event.data : undefined);
        }
      } catch {
        callbacks.onStatus(event.data || undefined);
      }
      return accumulators;
    }

    case 'result': {
      try {
        const resultData = JSON.parse(event.data);
        callbacks.onResult(resultData.usage || null);
      } catch {
        callbacks.onResult(null);
      }
      callbacks.onStatus(undefined);
      return accumulators;
    }

    case 'permission_request': {
      try {
        const permData: PermissionRequestEvent = JSON.parse(event.data);
        callbacks.onPermissionRequest(permData);
      } catch {
        // skip malformed permission_request data
      }
      return accumulators;
    }

    case 'tool_timeout': {
      try {
        const timeoutData = JSON.parse(event.data);
        callbacks.onToolTimeout(timeoutData.tool_name, timeoutData.elapsed_seconds);
      } catch {
        // skip malformed timeout data
      }
      return accumulators;
    }

    case 'mode_changed': {
      callbacks.onModeChanged(event.data);
      return accumulators;
    }

    case 'task_update': {
      try {
        const taskData = JSON.parse(event.data);
        callbacks.onTaskUpdate(taskData.session_id);
      } catch {
        // skip malformed task_update data
      }
      return accumulators;
    }

    case 'persisted': {
      try {
        const persistedData = JSON.parse(event.data) as AssistantPersistedEventData;
        if (persistedData.client_message_id && persistedData.message_id) {
          callbacks.onAssistantPersisted(persistedData);
        }
      } catch {
        // skip malformed persisted data
      }
      return accumulators;
    }

    case 'user_persisted': {
      try {
        const persistedData = JSON.parse(event.data) as UserPersistedEventData;
        if (persistedData.client_message_id && persistedData.message_id) {
          callbacks.onUserPersisted(persistedData);
        }
      } catch {
        // skip malformed persisted data
      }
      return accumulators;
    }

    case 'error': {
      const prefix = accumulators.text ? `${accumulators.text}\n\n` : '';
      const next = prefix + formatModelFailureMessage(event.data);
      callbacks.onError(next, event.data);
      return { ...accumulators, text: next };
    }

    default:
      return accumulators;
  }
}

export async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks,
  options: ConsumeSSEStreamOptions = {},
): Promise<{ accumulated: string; tokenUsage: TokenUsage | null }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulators: StreamAccumulators = {
    text: '',
    reasoning: '',
    assistantAttemptCheckpoint: null,
  };
  let tokenUsage: TokenUsage | null = null;

  const wrappedCallbacks: SSECallbacks = {
    ...callbacks,
    onResult: (usage) => {
      tokenUsage = usage;
      callbacks.onResult(usage);
    },
  };
  const legacyFallbackEnabled = options.allowLegacyFallback === true
    && getChatRolloutMode() === 'legacy';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        const sessionId = deriveSessionId(event, options.sessionId);
        const agentEvent = sessionId
          ? sdkAdapter.adaptSSEEvent(event, {
              sessionId,
              source: options.source || 'sdk',
            })
          : null;

        if (agentEvent) {
          if (options.emitToEventBus !== false) {
            agentEventBus.emit(agentEvent);
          }
          accumulators = dispatchAgentEvent(agentEvent, accumulators, wrappedCallbacks);
          continue;
        }

        if (!legacyFallbackEnabled) {
          continue;
        }

        // Legacy fallback is kept only for callers that do not provide enough
        // session context to materialize typed runtime events.
        accumulators = handleSSEEvent(event, accumulators, wrappedCallbacks);
      } catch (err) {
        // skip malformed SSE lines
        if (process.env.NODE_ENV === 'development') {
          console.warn('[SSE] Failed to parse event:', line, err);
        }
      }
    }
  }

  return { accumulated: accumulators.text, tokenUsage };
}

export function useSSEStream() {
  const callbacksRef = useRef<SSECallbacks | null>(null);

  const processStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      callbacks: SSECallbacks,
      options?: ConsumeSSEStreamOptions,
    ) => {
      callbacksRef.current = callbacks;

      const proxied: SSECallbacks = {
        onText: (a) => callbacksRef.current?.onText(a),
        onReasoning: (a) => callbacksRef.current?.onReasoning(a),
        onAssistantAttemptStart: () => callbacksRef.current?.onAssistantAttemptStart?.(),
        onAssistantAttemptReset: (checkpoint) => callbacksRef.current?.onAssistantAttemptReset?.(checkpoint),
        onToolUse: (t) => callbacksRef.current?.onToolUse(t),
        onToolResult: (r) => callbacksRef.current?.onToolResult(r),
        onToolOutput: (d) => callbacksRef.current?.onToolOutput(d),
        onToolProgress: (n, s) => callbacksRef.current?.onToolProgress(n, s),
        onStatus: (t) => callbacksRef.current?.onStatus(t),
        onResult: (u) => callbacksRef.current?.onResult(u),
        onPermissionRequest: (d) => callbacksRef.current?.onPermissionRequest(d),
        onToolTimeout: (n, s) => callbacksRef.current?.onToolTimeout(n, s),
        onModeChanged: (m) => callbacksRef.current?.onModeChanged(m),
        onTaskUpdate: (s) => callbacksRef.current?.onTaskUpdate(s),
        onUserPersisted: (d) => callbacksRef.current?.onUserPersisted(d),
        onAssistantPersisted: (d) => callbacksRef.current?.onAssistantPersisted(d),
        onActivity: (a) => callbacksRef.current?.onActivity?.(a),
        onHeartbeat: () => callbacksRef.current?.onHeartbeat?.(),
        onError: (a, d) => callbacksRef.current?.onError(a, d),
      };

      return consumeSSEStream(reader, proxied, options);
    },
    [],
  );

  return { processStream };
}
