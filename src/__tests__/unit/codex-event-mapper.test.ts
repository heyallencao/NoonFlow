import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  appendCodexDelta,
  buildCodexThreadStartedStatusEvent,
  extractCodexItemEnvelope,
  mapCodexAgentStateActivities,
  mapCodexChildActivityEvent,
} from '../../lib/codex/event-mapper';

describe('codex event mapper', () => {
  it('maps collabAgentToolCall and subAgentActivity into the shared activity shape', () => {
    const started = mapCodexChildActivityEvent({
      type: 'item.started',
      item: {
        id: 'collab-1',
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        status: 'inProgress',
        senderThreadId: 'thread-parent',
        receiverThreadIds: ['thread-child'],
        agentsStates: {
          'thread-child': { status: 'running', message: 'Starting review' },
        },
        prompt: 'full prompt must not leak into the activity UI',
      },
    }, undefined, 1_000);
    assert.deepEqual(started, {
      id: 'collab-1',
      parentId: 'thread-parent',
      runtime: 'codex',
      kind: 'subagent',
      title: 'Codex subagent',
      status: 'running',
      summary: 'Starting review',
      startedAt: 1_000,
      updatedAt: 1_000,
    });

    const completed = mapCodexChildActivityEvent({
      type: 'item.completed',
      item: {
        id: 'collab-1',
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: 'thread-parent',
        receiverThreadIds: ['thread-child'],
        agentsStates: {
          'thread-child': { status: 'completed', message: 'Review complete' },
        },
      },
    }, started ?? undefined, 2_000);
    assert.equal(completed?.status, 'completed');
    assert.equal(completed?.startedAt, 1_000);
    assert.equal(completed?.updatedAt, 2_000);

    const subAgentStarted = mapCodexChildActivityEvent({
      type: 'item.completed',
      item: {
        id: 'subactivity-started',
        type: 'subAgentActivity',
        agentThreadId: 'thread-child',
        agentPath: 'root/reviewer',
        kind: 'started',
      },
    }, undefined, 3_000);
    assert.equal(subAgentStarted?.id, 'thread-child');
    assert.equal(subAgentStarted?.runtime, 'codex');
    assert.equal(subAgentStarted?.kind, 'subagent');
    assert.equal(subAgentStarted?.title, 'reviewer');
    assert.equal(subAgentStarted?.status, 'running');

    const subAgentInteracted = mapCodexChildActivityEvent({
      type: 'item.completed',
      item: {
        id: 'subactivity-interacted',
        type: 'subAgentActivity',
        agentThreadId: 'thread-child',
        agentPath: 'root/reviewer',
        kind: 'interacted',
      },
    }, subAgentStarted ?? undefined, 4_000);
    assert.equal(subAgentInteracted?.id, 'thread-child');
    assert.equal(subAgentInteracted?.status, 'running');
    assert.equal(subAgentInteracted?.startedAt, 3_000);

    const subAgentInterrupted = mapCodexChildActivityEvent({
      type: 'item.completed',
      item: {
        id: 'subactivity-interrupted',
        type: 'subAgentActivity',
        agentThreadId: 'thread-child',
        agentPath: 'root/reviewer',
        kind: 'interrupted',
      },
    }, subAgentInteracted ?? undefined, 5_000);
    assert.equal(subAgentInterrupted?.id, 'thread-child');
    assert.equal(subAgentInterrupted?.status, 'stopped');
    assert.equal(subAgentInterrupted?.startedAt, 3_000);
  });

  it('maps every native agentsStates status by stable thread id', () => {
    const previous = new Map([
      ['thread-completed', {
        id: 'thread-completed',
        parentId: 'thread-parent',
        runtime: 'codex' as const,
        kind: 'subagent',
        title: 'reviewer',
        status: 'running' as const,
        startedAt: 500,
        updatedAt: 500,
      }],
    ]);
    const activities = mapCodexAgentStateActivities({
      type: 'item.completed',
      item: {
        id: 'collab-terminal',
        type: 'collabAgentToolCall',
        tool: 'wait',
        status: 'completed',
        senderThreadId: 'thread-parent',
        receiverThreadIds: [
          'thread-pending',
          'thread-running',
          'thread-completed',
          'thread-errored',
          'thread-interrupted',
          'thread-shutdown',
          'thread-missing',
        ],
        agentsStates: {
          'thread-pending': { status: 'pendingInit', message: null },
          'thread-running': { status: 'running', message: null },
          'thread-completed': { status: 'completed', message: 'Done' },
          'thread-errored': { status: 'errored', message: 'Failed' },
          'thread-interrupted': { status: 'interrupted', message: null },
          'thread-shutdown': { status: 'shutdown', message: null },
          'thread-missing': { status: 'notFound', message: null },
        },
      },
    }, (id) => previous.get(id), 2_000);

    assert.deepEqual(activities.map((activity) => [activity.id, activity.status]), [
      ['thread-pending', 'waiting'],
      ['thread-running', 'running'],
      ['thread-completed', 'completed'],
      ['thread-errored', 'failed'],
      ['thread-interrupted', 'stopped'],
      ['thread-shutdown', 'stopped'],
      ['thread-missing', 'failed'],
    ]);
    assert.equal(activities[2]?.title, 'reviewer');
    assert.equal(activities[2]?.startedAt, 500);
    assert.equal(activities[2]?.summary, 'Done');
    assert.ok(activities.every((activity) => activity.parentId === 'thread-parent'));
  });

  it('does not turn unrelated notifications into thread status events', () => {
    assert.equal(buildCodexThreadStartedStatusEvent({ type: 'turn.completed' }), null);
    assert.equal(buildCodexThreadStartedStatusEvent({ type: 'error' }), null);
  });

  it('builds thread started status payload with optional model', () => {
    const statusEvent = buildCodexThreadStartedStatusEvent(
      { type: 'thread.started', thread_id: 'thread-1' },
      'gpt-5.4',
    );

    assert.ok(statusEvent);
    assert.equal(statusEvent?.type, 'status');
    const payload = JSON.parse(statusEvent?.data || '{}') as { session_id?: string; model?: string };
    assert.equal(payload.session_id, 'thread-1');
    assert.equal(payload.model, 'gpt-5.4');
  });

  it('contains no old turn-usage normalizer that can add cached input twice', () => {
    const source = fs.readFileSync(path.resolve('src/lib/codex/event-mapper.ts'), 'utf8');
    assert.doesNotMatch(source, /cached_input_tokens|cache_read_input_tokens|turn\.completed/);
  });

  it('extracts item envelope from nested details or top-level item payload', () => {
    const nested = extractCodexItemEnvelope({
      type: 'item.updated',
      item: {
        id: 'item-nested',
        details: {
          type: 'reasoning',
          text: 'thinking',
        },
      },
    });

    assert.ok(nested);
    assert.equal(nested?.itemId, 'item-nested');
    assert.equal(nested?.details.type, 'reasoning');

    const topLevel = extractCodexItemEnvelope({
      type: 'item.completed',
      item: {
        id: 'item-top-level',
        type: 'agent_message',
        text: 'answer',
      },
    });

    assert.ok(topLevel);
    assert.equal(topLevel?.itemId, 'item-top-level');
    assert.equal(topLevel?.details.type, 'agent_message');
  });

  it('returns null for non-item events or malformed item payload', () => {
    assert.equal(extractCodexItemEnvelope({ type: 'turn.started' }), null);
    assert.equal(
      extractCodexItemEnvelope({
        type: 'item.completed',
        item: {
          id: 'item-bad',
        },
      }),
      null,
    );
  });

  it('computes incremental deltas for prefix and divergent text updates', () => {
    assert.equal(appendCodexDelta('', 'hello'), 'hello');
    assert.equal(appendCodexDelta('hello', 'hello world'), ' world');
    assert.equal(appendCodexDelta('abcXYZ', 'abc123'), '123');
  });
});
