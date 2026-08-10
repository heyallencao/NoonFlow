import type { ChildActivity, PermissionRequestEvent, TokenUsage } from '@/types';

export type AgentEventSource = 'sdk' | 'bridge' | 'ui';

export interface EventMetadata {
  sessionId: string;
  timestamp: number;
  source: AgentEventSource;
  rawType?: string;
  eventId: string;
}

interface BaseAgentEvent<TType extends string> {
  type: TType;
  metadata: EventMetadata;
}

export interface SessionStartedEvent extends BaseAgentEvent<'session.started'> {
  model?: string;
  sdkSessionId?: string;
  tools?: string[];
}

export interface MessageDeltaEvent extends BaseAgentEvent<'message.delta'> {
  role: 'user' | 'assistant';
  content: string;
}

export interface MessageReasoningEvent extends BaseAgentEvent<'message.reasoning'> {
  content: string;
}

export type MessageAttemptStartedEvent = BaseAgentEvent<'message.attempt.started'>;

export type MessageAttemptResetEvent = BaseAgentEvent<'message.attempt.reset'>;

export interface ToolStartEvent extends BaseAgentEvent<'tool.start'> {
  toolName: string;
  toolUseId: string;
  input: unknown;
}

export interface ToolResultEvent extends BaseAgentEvent<'tool.result'> {
  toolUseId: string;
  toolName?: string;
  output: unknown;
  success: boolean;
  isError?: boolean;
}

export interface ToolOutputEvent extends BaseAgentEvent<'tool.output'> {
  toolUseId?: string;
  toolName?: string;
  content: string;
}

export interface ToolProgressEvent extends BaseAgentEvent<'tool.progress'> {
  toolUseId?: string;
  toolName: string;
  elapsedSeconds: number;
}

export interface ToolTimeoutEvent extends BaseAgentEvent<'tool.timeout'> {
  toolUseId?: string;
  toolName: string;
  elapsedSeconds: number;
}

export interface ActivityUpdatedEvent extends BaseAgentEvent<'activity.updated'> {
  activity: ChildActivity;
}

export type RuntimeHeartbeatEvent = BaseAgentEvent<'runtime.heartbeat'>;

export interface PermissionRequiredEvent extends BaseAgentEvent<'permission.required'> {
  request: PermissionRequestEvent;
}

export interface PermissionResolvedEvent extends BaseAgentEvent<'permission.resolved'> {
  permissionRequestId: string;
  approved: boolean;
  message?: string;
}

export interface ModeChangedEvent extends BaseAgentEvent<'mode.changed'> {
  mode: string;
}

export interface TasksUpdatedEvent extends BaseAgentEvent<'tasks.updated'> {
  tasks: unknown[];
}

export interface StatusUpdatedEvent extends BaseAgentEvent<'status.updated'> {
  status?: string;
  detail?: string;
  raw?: unknown;
}

export interface SessionResultEvent extends BaseAgentEvent<'session.result'> {
  usage: TokenUsage | null;
  isError: boolean;
  sdkSessionId?: string;
  durationMs?: number;
}

export interface SessionCompletedEvent extends BaseAgentEvent<'session.completed'> {
  usage: TokenUsage | null;
}

export interface UserPersistedEvent extends BaseAgentEvent<'message.user.persisted'> {
  clientMessageId: string;
  messageId: string;
  createdAt: string;
}

export interface AssistantPersistedEvent extends BaseAgentEvent<'message.assistant.persisted'> {
  clientMessageId: string;
  messageId: string;
  revision: number;
  createdAt: string;
}

export interface SessionErrorEvent extends BaseAgentEvent<'session.error'> {
  error: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | MessageDeltaEvent
  | MessageReasoningEvent
  | MessageAttemptStartedEvent
  | MessageAttemptResetEvent
  | ToolStartEvent
  | ToolResultEvent
  | ToolOutputEvent
  | ToolProgressEvent
  | ToolTimeoutEvent
  | ActivityUpdatedEvent
  | RuntimeHeartbeatEvent
  | PermissionRequiredEvent
  | PermissionResolvedEvent
  | ModeChangedEvent
  | TasksUpdatedEvent
  | StatusUpdatedEvent
  | SessionResultEvent
  | SessionCompletedEvent
  | UserPersistedEvent
  | AssistantPersistedEvent
  | SessionErrorEvent;

export type AgentEventType = AgentEvent['type'];

export function createEventMetadata(
  sessionId: string,
  source: AgentEventSource,
  rawType?: string,
  timestamp: number = Date.now(),
): EventMetadata {
  return {
    sessionId,
    timestamp,
    source,
    rawType,
    eventId: `${sessionId}:${rawType || 'event'}:${timestamp}`,
  };
}
