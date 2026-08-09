import type { SSEEvent } from '@/types';

export interface CodexThreadEvent {
  type: string;
  [key: string]: unknown;
}

interface CodexThreadStartedEvent extends CodexThreadEvent {
  type: 'thread.started';
  thread_id?: unknown;
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
