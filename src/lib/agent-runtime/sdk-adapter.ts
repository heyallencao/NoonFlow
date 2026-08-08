import type {
  AssistantPersistedEventData,
  PermissionRequestEvent,
  SSEEvent,
  TokenUsage,
  UserPersistedEventData,
} from '@/types';
import {
  createEventMetadata,
  type AgentEvent,
  type AgentEventSource,
} from './event-types';

interface AdapterContext {
  sessionId: string;
  source: AgentEventSource;
  timestamp?: number;
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeTokenUsage(value: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: string | number;
} | null | undefined): TokenUsage | null {
  if (!value) {
    return null;
  }

  return {
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cache_read_input_tokens: value.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: value.cache_creation_input_tokens ?? 0,
    cost_usd: typeof value.cost_usd === 'number'
      ? value.cost_usd
      : typeof value.cost_usd === 'string'
      ? Number(value.cost_usd)
      : undefined,
  };
}

export class SDKAdapter {
  adaptSSEEvent(event: SSEEvent, context: AdapterContext): AgentEvent | null {
    const metadata = createEventMetadata(
      context.sessionId,
      context.source,
      event.type,
      context.timestamp,
    );

    switch (event.type) {
      case 'text':
        return {
          type: 'message.delta',
          metadata,
          role: 'assistant',
          content: event.data,
        };

      case 'reasoning':
        return {
          type: 'message.reasoning',
          metadata,
          content: event.data,
        };

      case 'tool_use': {
        const payload = tryParseJson<{ id: string; name: string; input: unknown }>(event.data);
        if (!payload?.id || !payload.name) {
          return null;
        }
        return {
          type: 'tool.start',
          metadata,
          toolName: payload.name,
          toolUseId: payload.id,
          input: payload.input,
        };
      }

      case 'tool_result': {
        const payload = tryParseJson<{
          tool_use_id: string;
          tool_name?: string;
          content: unknown;
          is_error?: boolean;
        }>(event.data);
        if (!payload?.tool_use_id) {
          return null;
        }
        return {
          type: 'tool.result',
          metadata,
          toolUseId: payload.tool_use_id,
          toolName: payload.tool_name,
          output: payload.content,
          success: !payload.is_error,
          isError: payload.is_error,
        };
      }

      case 'tool_output': {
        const payload = tryParseJson<{
          _progress?: boolean;
          tool_use_id?: string;
          tool_name?: string;
          elapsed_time_seconds?: number;
        }>(event.data);
        if (payload?._progress && payload.tool_name) {
          return {
            type: 'tool.progress',
            metadata,
            toolUseId: payload.tool_use_id,
            toolName: payload.tool_name,
            elapsedSeconds: Math.round(payload.elapsed_time_seconds || 0),
          };
        }

        return {
          type: 'tool.output',
          metadata,
          content: event.data,
        };
      }

      case 'status': {
        const payload = tryParseJson<{ session_id?: string; model?: string; tools?: string[]; message?: string; title?: string }>(event.data);
        if (payload?.session_id || payload?.model || payload?.tools) {
          return {
            type: 'session.started',
            metadata,
            sdkSessionId: payload?.session_id,
            model: payload?.model,
            tools: payload?.tools,
          };
        }

        return {
          type: 'status.updated',
          metadata,
          status: payload?.message || event.data || undefined,
          detail: payload?.title,
          raw: payload || event.data,
        };
      }

      case 'result': {
        const payload = tryParseJson<{
          usage?: {
            input_tokens: number;
            output_tokens: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
            cost_usd?: string;
          } | null;
          is_error?: boolean;
          session_id?: string;
          duration_ms?: number;
        }>(event.data);
        return {
          type: 'session.result',
          metadata,
          usage: normalizeTokenUsage(payload?.usage),
          isError: Boolean(payload?.is_error),
          sdkSessionId: payload?.session_id,
          durationMs: payload?.duration_ms,
        };
      }

      case 'permission_request': {
        const payload = tryParseJson<PermissionRequestEvent>(event.data);
        if (!payload?.permissionRequestId) {
          return null;
        }
        return {
          type: 'permission.required',
          metadata,
          request: payload,
        };
      }

      case 'mode_changed':
        return {
          type: 'mode.changed',
          metadata,
          mode: event.data,
        };

      case 'task_update': {
        const payload = tryParseJson<{ todos?: unknown[] }>(event.data);
        return {
          type: 'tasks.updated',
          metadata,
          tasks: payload?.todos || [],
        };
      }

      case 'done':
        return {
          type: 'session.completed',
          metadata,
          usage: null,
        };

      case 'user_persisted': {
        const payload = tryParseJson<UserPersistedEventData>(event.data);
        if (!payload?.client_message_id || !payload.message_id) {
          return null;
        }
        return {
          type: 'message.user.persisted',
          metadata,
          clientMessageId: payload.client_message_id,
          messageId: payload.message_id,
          createdAt: payload.created_at,
        };
      }

      case 'persisted': {
        const payload = tryParseJson<AssistantPersistedEventData>(event.data);
        if (!payload?.client_message_id || !payload.message_id) {
          return null;
        }
        return {
          type: 'message.assistant.persisted',
          metadata,
          clientMessageId: payload.client_message_id,
          messageId: payload.message_id,
          revision: payload.revision ?? 0,
          createdAt: payload.created_at,
        };
      }

      case 'error':
        return {
          type: 'session.error',
          metadata,
          error: event.data || 'Unknown error',
        };

      case 'tool_timeout': {
        const payload = tryParseJson<{ tool_name?: string; elapsed_seconds?: number }>(event.data);
        return {
          type: 'tool.timeout',
          metadata,
          toolUseId: undefined,
          toolName: payload?.tool_name || 'unknown',
          elapsedSeconds: Math.round(payload?.elapsed_seconds || 0),
        };
      }

      default:
        return null;
    }
  }

  adaptSDKEvent(rawEvent: unknown, context: AdapterContext): AgentEvent | null {
    if (!rawEvent || typeof rawEvent !== 'object') {
      return null;
    }

    const event = rawEvent as {
      type?: string;
      subtype?: string;
      session_id?: string;
      model?: string;
      tools?: string[];
      message?: { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }> };
      tool_name?: string;
      tool_use_id?: string;
      elapsed_time_seconds?: number;
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        cost_usd?: string;
      } | null;
      is_error?: boolean;
      duration_ms?: number;
      permissionMode?: string;
    };

    const metadata = createEventMetadata(
      context.sessionId,
      context.source,
      event.type,
      context.timestamp,
    );

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          return {
            type: 'session.started',
            metadata,
            sdkSessionId: event.session_id,
            model: event.model,
            tools: event.tools,
          };
        }
        if (event.subtype === 'status' && event.permissionMode) {
          return {
            type: 'mode.changed',
            metadata,
            mode: event.permissionMode,
          };
        }
        return null;

      case 'assistant': {
        const textBlock = event.message?.content?.find((block) => block.type === 'text' && block.text);
        if (textBlock?.text) {
          return {
            type: 'message.delta',
            metadata,
            role: 'assistant',
            content: textBlock.text,
          };
        }

        const reasoningBlock = event.message?.content?.find((block) => block.type === 'reasoning' && block.text);
        if (!reasoningBlock?.text) {
          return null;
        }

        return {
          type: 'message.reasoning',
          metadata,
          content: reasoningBlock.text,
        };
      }

      case 'user': {
        const toolResultBlock = event.message?.content?.find((block) => block.type === 'tool_result');
        if (!toolResultBlock?.tool_use_id) {
          return null;
        }
        return {
          type: 'tool.result',
          metadata,
          toolUseId: toolResultBlock.tool_use_id,
          output: toolResultBlock.content,
          success: !toolResultBlock.is_error,
          isError: toolResultBlock.is_error,
        };
      }

      case 'tool_progress':
        if (!event.tool_name) {
          return null;
        }
        return {
          type: 'tool.progress',
          metadata,
          toolUseId: event.tool_use_id,
          toolName: event.tool_name,
          elapsedSeconds: Math.round(event.elapsed_time_seconds || 0),
        };

      case 'result':
        return {
          type: 'session.result',
          metadata,
          usage: normalizeTokenUsage(event.usage),
          isError: Boolean(event.is_error),
          sdkSessionId: event.session_id,
          durationMs: event.duration_ms,
        };

      default:
        return null;
    }
  }
}

export const sdkAdapter = new SDKAdapter();
