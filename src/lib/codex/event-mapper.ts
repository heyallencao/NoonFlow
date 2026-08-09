import type { ChildActivity, ChildActivityStatus, SSEEvent } from '@/types';

export interface CodexThreadEvent {
  type: string;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCodexActivityStatus(
  value: unknown,
  eventType: string,
  waiting = false,
  lifecyclePoint = false,
): ChildActivityStatus {
  const normalized = asString(value).replace(/[_\s-]/g, '').toLowerCase();
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'succeeded' || normalized === 'success') {
    return 'completed';
  }
  if (normalized === 'failed' || normalized === 'errored' || normalized === 'error' || normalized === 'declined') {
    return 'failed';
  }
  if (normalized === 'notfound') {
    return 'failed';
  }
  if (normalized === 'stopped' || normalized === 'interrupted' || normalized === 'cancelled' || normalized === 'canceled' || normalized === 'closed' || normalized === 'killed') {
    return 'stopped';
  }
  if (normalized === 'shutdown') {
    return 'stopped';
  }
  if (normalized === 'waiting' || normalized === 'wait' || normalized === 'paused' || normalized === 'pendinginit') {
    return 'waiting';
  }
  // SubAgentActivity items are completed point events whose `kind` describes
  // the child lifecycle. Completing the envelope must not complete the child.
  if (lifecyclePoint && (normalized === 'started' || normalized === 'interacted' || normalized === 'inprogress' || normalized === 'running')) {
    return 'running';
  }
  if (eventType === 'item.completed') {
    return 'completed';
  }
  return waiting ? 'waiting' : 'running';
}

function codexAgentTitle(item: Record<string, unknown>): string {
  const receiverAgents = Array.isArray(item.receiverAgents)
    ? item.receiverAgents
    : Array.isArray(item.receiver_agents)
      ? item.receiver_agents
      : [];
  for (const candidate of receiverAgents) {
    const agent = asRecord(candidate);
    const nickname = asString(agent?.agentNickname ?? agent?.agent_nickname ?? agent?.nickname);
    if (nickname) return nickname;
  }

  const receiverAgent = asRecord(item.receiverAgent ?? item.receiver_agent);
  const nickname = asString(
    receiverAgent?.agentNickname
      ?? receiverAgent?.agent_nickname
      ?? receiverAgent?.nickname
      ?? item.receiverAgentNickname
      ?? item.receiver_agent_nickname,
  );
  if (nickname) return nickname;

  const agentStatus = asRecord(item.agentStatus ?? item.agent_status);
  const statusNickname = asString(
    agentStatus?.agentNickname ?? agentStatus?.agent_nickname ?? agentStatus?.nickname,
  );
  if (statusNickname) return statusNickname;

  const path = asString(item.agentPath ?? item.agent_path);
  if (path) {
    return path.split('/').filter(Boolean).at(-1) || 'Codex subagent';
  }
  const tool = asString(item.tool).replace(/[_-]/g, '').toLowerCase();
  if (tool === 'wait') return 'Waiting for Codex subagent';
  if (tool === 'sendinput') return 'Codex subagent input';
  if (tool === 'closeagent') return 'Stopping Codex subagent';
  return 'Codex subagent';
}

function codexActivitySummary(item: Record<string, unknown>): string | undefined {
  const rawStates = item.agentsStates ?? item.agents_states;
  const stateRecord = asRecord(rawStates);
  const states = Array.isArray(rawStates)
    ? rawStates
    : stateRecord
      ? Object.values(stateRecord)
      : [];
  const labels = states.flatMap((candidate) => {
    const state = asRecord(candidate);
    const nickname = asString(state?.agentNickname ?? state?.agent_nickname ?? state?.nickname);
    const status = asString(state?.status);
    const message = asString(state?.message);
    if (message) return [message];
    return nickname || status ? [`${nickname || 'agent'}${status ? `: ${status}` : ''}`] : [];
  });
  if (labels.length > 0) return labels.join(', ');
  const agentStatus = item.agentStatus ?? item.agent_status;
  if (typeof agentStatus === 'string') return agentStatus;
  const statusRecord = asRecord(agentStatus);
  return asString(statusRecord?.status ?? statusRecord?.message) || undefined;
}

export function getCodexChildActivityId(event: CodexThreadEvent): string {
  const rawItem = asRecord(event.item);
  if (!rawItem) return '';
  const item = asRecord(rawItem.details) ?? rawItem;
  const normalizedType = asString(item.type).replace(/[_-]/g, '').toLowerCase();
  if (normalizedType === 'subagentactivity') {
    return asString(item.agentThreadId ?? item.agent_thread_id)
      || asString(rawItem.id ?? item.id);
  }
  return asString(rawItem.id ?? item.id);
}

export function mapCodexChildActivityEvent(
  event: CodexThreadEvent,
  previous?: ChildActivity,
  now: number = Date.now(),
): ChildActivity | null {
  if (event.type !== 'item.started' && event.type !== 'item.updated' && event.type !== 'item.completed') {
    return null;
  }
  const rawItem = asRecord(event.item);
  if (!rawItem) return null;
  const item = asRecord(rawItem.details) ?? rawItem;
  const rawType = asString(item.type);
  const normalizedType = rawType.replace(/[_-]/g, '').toLowerCase();
  if (normalizedType !== 'collabagenttoolcall' && normalizedType !== 'collabtoolcall' && normalizedType !== 'subagentactivity') {
    return null;
  }

  const id = getCodexChildActivityId(event);
  if (!id) return null;
  const tool = asString(item.tool);
  const waiting = tool.replace(/[_-]/g, '').toLowerCase() === 'wait';
  const parentId = asString(item.senderThreadId ?? item.sender_thread_id) || previous?.parentId;
  const summary = codexActivitySummary(item) ?? previous?.summary;

  return {
    id,
    ...(parentId ? { parentId } : {}),
    runtime: 'codex',
    kind: 'subagent',
    title: codexAgentTitle(item) || previous?.title || 'Codex subagent',
    status: normalizeCodexActivityStatus(
      item.status ?? item.kind,
      event.type,
      waiting,
      normalizedType === 'subagentactivity',
    ),
    ...(summary ? { summary } : {}),
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
  };
}

export function mapCodexAgentStateActivities(
  event: CodexThreadEvent,
  previousById: (id: string) => ChildActivity | undefined,
  now: number = Date.now(),
): ChildActivity[] {
  if (event.type !== 'item.started' && event.type !== 'item.updated' && event.type !== 'item.completed') {
    return [];
  }
  const rawItem = asRecord(event.item);
  if (!rawItem) return [];
  const item = asRecord(rawItem.details) ?? rawItem;
  const normalizedType = asString(item.type).replace(/[_-]/g, '').toLowerCase();
  if (normalizedType !== 'collabagenttoolcall' && normalizedType !== 'collabtoolcall') {
    return [];
  }
  const states = asRecord(item.agentsStates ?? item.agents_states);
  if (!states) return [];
  const parentId = asString(item.senderThreadId ?? item.sender_thread_id);

  return Object.entries(states).flatMap(([threadId, candidate]) => {
    const id = threadId.trim();
    const state = asRecord(candidate);
    if (!id || !state) return [];
    const previous = previousById(id);
    const summary = asString(state.message) || previous?.summary;
    return [{
      id,
      ...(parentId || previous?.parentId ? { parentId: parentId || previous?.parentId } : {}),
      runtime: 'codex' as const,
      kind: 'subagent',
      title: previous?.title || 'Codex subagent',
      status: normalizeCodexActivityStatus(state.status, 'item.updated'),
      ...(summary ? { summary } : {}),
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
    }];
  });
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
