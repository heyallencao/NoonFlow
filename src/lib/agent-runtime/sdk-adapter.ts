import type {
  AssistantRuntime,
  AssistantPersistedEventData,
  ChildActivity,
  ChildActivityStatus,
  PermissionRequestEvent,
  SSEEvent,
  TokenUsage,
  UserPersistedEventData,
} from '@/types';
import {
  getCodexChildActivityId,
  mapCodexAgentStateActivities,
  mapCodexChildActivityEvent,
} from '@/lib/codex/event-mapper';
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const CHILD_ACTIVITY_STATUSES = new Set<ChildActivityStatus>([
  'running',
  'waiting',
  'completed',
  'failed',
  'stopped',
]);

function parseChildActivity(value: string): ChildActivity | null {
  const payload = tryParseJson<Record<string, unknown>>(value);
  const runtime = asString(payload?.runtime);
  const status = asString(payload?.status) as ChildActivityStatus;
  const id = asString(payload?.id);
  const kind = asString(payload?.kind);
  const title = asString(payload?.title);
  const startedAt = payload?.startedAt;
  const updatedAt = payload?.updatedAt;
  if (
    !id
    || (runtime !== 'claude_code' && runtime !== 'codex' && runtime !== 'pi')
    || !kind
    || !title
    || !CHILD_ACTIVITY_STATUSES.has(status)
    || typeof startedAt !== 'number'
    || !Number.isFinite(startedAt)
    || typeof updatedAt !== 'number'
    || !Number.isFinite(updatedAt)
  ) {
    return null;
  }
  const parentId = asString(payload?.parentId);
  const summary = asString(payload?.summary);
  return {
    id,
    ...(parentId ? { parentId } : {}),
    runtime,
    kind,
    title,
    status,
    ...(summary ? { summary } : {}),
    startedAt,
    updatedAt,
  };
}

function normalizeClaudeStatus(value: unknown): ChildActivityStatus {
  switch (asString(value)) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'stopped':
    case 'killed': return 'stopped';
    case 'paused':
    case 'pending': return 'waiting';
    default: return 'running';
  }
}

export class RuntimeActivityAdapter {
  private readonly activities = new Map<string, ChildActivity>();
  private backgroundTaskIds = new Set<string>();

  constructor(
    private readonly runtime: Exclude<AssistantRuntime, 'pi'>,
    _sessionId: string,
    private readonly now: () => number = Date.now,
  ) {}

  adapt(rawEvent: unknown): ChildActivity[] {
    const event = asRecord(rawEvent);
    if (!event) return [];
    if (this.runtime === 'claude_code') return this.adaptClaude(event);
    return this.adaptCodex(event);
  }

  stopRunning(status: Extract<ChildActivityStatus, 'failed' | 'stopped'>): ChildActivity[] {
    const now = this.now();
    const updates: ChildActivity[] = [];
    for (const activity of this.activities.values()) {
      if (activity.status !== 'running' && activity.status !== 'waiting') continue;
      updates.push(this.upsert({ ...activity, status, updatedAt: now }));
    }
    return updates;
  }

  private upsert(activity: ChildActivity): ChildActivity {
    this.activities.set(activity.id, activity);
    return activity;
  }

  private adaptClaude(event: Record<string, unknown>): ChildActivity[] {
    if (event.type !== 'system') return [];
    const subtype = asString(event.subtype);
    const now = this.now();

    if (subtype === 'background_tasks_changed') {
      const nextIds = new Set<string>();
      const updates: ChildActivity[] = [];
      const tasks = Array.isArray(event.tasks) ? event.tasks : [];
      for (const candidate of tasks) {
        const task = asRecord(candidate);
        const id = asString(task?.task_id);
        if (!id) continue;
        nextIds.add(id);
        const previous = this.activities.get(id);
        updates.push(this.upsert({
          id,
          ...(previous?.parentId ? { parentId: previous.parentId } : {}),
          runtime: 'claude_code',
          kind: 'background',
          title: asString(task?.description) || previous?.title || 'Claude background task',
          status: 'running',
          ...(previous?.summary ? { summary: previous.summary } : {}),
          startedAt: previous?.startedAt ?? now,
          updatedAt: now,
        }));
      }
      this.backgroundTaskIds = nextIds;
      return updates;
    }

    if (subtype !== 'task_started' && subtype !== 'task_progress' && subtype !== 'task_notification' && subtype !== 'task_updated') {
      return [];
    }
    const id = asString(event.task_id);
    if (!id) return [];
    const previous = this.activities.get(id);
    const patch = asRecord(event.patch);
    const rawStatus = subtype === 'task_notification'
      ? event.status
      : subtype === 'task_updated'
        ? patch?.status
        : 'running';
    const parentId = asString(event.tool_use_id) || previous?.parentId;
    const description = asString(event.description ?? patch?.description);
    const taskType = asString(event.task_type);
    const subagentType = asString(event.subagent_type);
    const summary = asString(event.summary ?? patch?.error) || previous?.summary;
    const normalizedTaskType = taskType.replace(/[_-]/g, '').toLowerCase();
    const previousChildKind = previous?.kind === 'subagent'
      || previous?.kind === 'background'
      || previous?.kind === 'workflow'
      ? previous.kind
      : undefined;
    const background = this.backgroundTaskIds.has(id) || previousChildKind === 'background';
    const subagent = Boolean(subagentType)
      || normalizedTaskType === 'agent'
      || normalizedTaskType === 'subagent'
      || normalizedTaskType === 'remoteagent'
      || previousChildKind === 'subagent';
    const workflow = taskType === 'local_workflow' || previousChildKind === 'workflow';
    // Ordinary foreground tools can also emit task lifecycle edges. They stay
    // in ToolActionGroup and retain the configured wall-clock timeout.
    if (!background && !subagent && !workflow) return [];
    const kind = background ? 'background' : subagent ? 'subagent' : 'workflow';
    return [this.upsert({
      id,
      ...(parentId ? { parentId } : {}),
      runtime: 'claude_code',
      kind,
      title: description || previous?.title || subagentType || 'Claude task',
      status: normalizeClaudeStatus(rawStatus),
      ...(summary ? { summary } : {}),
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
    })];
  }

  private adaptCodex(event: Record<string, unknown>): ChildActivity[] {
    const now = this.now();
    const activityId = getCodexChildActivityId(event as { type: string; [key: string]: unknown });
    const previous = activityId ? this.activities.get(activityId) : undefined;
    const activity = mapCodexChildActivityEvent(event as { type: string; [key: string]: unknown }, previous, now);
    const updates = activity ? [this.upsert(activity)] : [];
    for (const agentActivity of mapCodexAgentStateActivities(
      event as { type: string; [key: string]: unknown },
      (id) => this.activities.get(id),
      now,
    )) {
      updates.push(this.upsert(agentActivity));
    }
    return updates;
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

      case 'assistant_attempt_start':
        return {
          type: 'message.attempt.started',
          metadata,
        };

      case 'assistant_attempt_reset':
        return {
          type: 'message.attempt.reset',
          metadata,
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

      case 'activity.updated': {
        const activity = parseChildActivity(event.data);
        if (!activity) return null;
        return {
          type: 'activity.updated',
          metadata,
          activity,
        };
      }

      case 'runtime.heartbeat':
        return {
          type: 'runtime.heartbeat',
          metadata,
        };

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
