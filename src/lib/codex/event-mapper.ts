import type { SSEEvent, TokenUsage } from '@/types';

export interface CodexThreadEvent {
  type: string;
  [key: string]: unknown;
}

interface CodexThreadStartedEvent extends CodexThreadEvent {
  type: 'thread.started';
  thread_id?: unknown;
}

interface CodexTurnCompletedEvent extends CodexThreadEvent {
  type: 'turn.completed';
  usage?: unknown;
}

const CONVERSATION_EVENT_TYPES = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'item.started',
  'item.updated',
  'item.completed',
]);

export function isCodexConversationEventType(eventType: string): boolean {
  return CONVERSATION_EVENT_TYPES.has(eventType);
}

export function toCodexTokenUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const usage = value as {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };

  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cached_input_tokens ?? 0,
  };
}

export function appendCodexDelta(previous: string, next: string): string {
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  let prefixLength = 0;
  while (
    prefixLength < previous.length
    && prefixLength < next.length
    && previous[prefixLength] === next[prefixLength]
  ) {
    prefixLength += 1;
  }
  return next.slice(prefixLength);
}

export function buildCodexThreadStartedStatusEvent(
  event: CodexThreadEvent,
  model?: string,
): SSEEvent | null {
  if (event.type !== 'thread.started') {
    return null;
  }

  const threadStarted = event as CodexThreadStartedEvent;
  const threadId = typeof threadStarted.thread_id === 'string' ? threadStarted.thread_id : '';

  return {
    type: 'status',
    data: JSON.stringify({
      session_id: threadId,
      ...(model ? { model } : {}),
    }),
  };
}

export function buildCodexTurnCompletedResultEvent(event: CodexThreadEvent): SSEEvent | null {
  if (event.type !== 'turn.completed') {
    return null;
  }

  const turnCompleted = event as CodexTurnCompletedEvent;
  return {
    type: 'result',
    data: JSON.stringify({ usage: toCodexTokenUsage(turnCompleted.usage) }),
  };
}

export function extractCodexItemEnvelope(
  event: CodexThreadEvent,
): { itemId: string; details: Record<string, unknown> } | null {
  if (event.type !== 'item.started' && event.type !== 'item.updated' && event.type !== 'item.completed') {
    return null;
  }

  const rawItem = event.item as {
    id?: string;
    type?: string;
    details?: { type?: string; [key: string]: unknown };
    [key: string]: unknown;
  } | undefined;
  const details = (
    rawItem?.details && typeof rawItem.details === 'object'
      ? rawItem.details
      : rawItem
  ) as { type?: string; [key: string]: unknown } | undefined;

  if (!details?.type) {
    return null;
  }

  return {
    itemId: rawItem?.id || `codex-item-${Date.now()}`,
    details,
  };
}
