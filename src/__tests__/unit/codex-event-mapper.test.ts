import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendCodexDelta,
  buildCodexThreadStartedStatusEvent,
  buildCodexTurnCompletedResultEvent,
  extractCodexItemEnvelope,
  isCodexConversationEventType,
} from '../../lib/codex/event-mapper';

describe('codex event mapper', () => {
  it('identifies conversation event types', () => {
    assert.equal(isCodexConversationEventType('thread.started'), true);
    assert.equal(isCodexConversationEventType('item.updated'), true);
    assert.equal(isCodexConversationEventType('error'), false);
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

  it('builds turn completed result payload and normalizes missing token fields', () => {
    const resultEvent = buildCodexTurnCompletedResultEvent({
      type: 'turn.completed',
      usage: { input_tokens: 7, output_tokens: 3 },
    });

    assert.ok(resultEvent);
    assert.equal(resultEvent?.type, 'result');
    const payload = JSON.parse(resultEvent?.data || '{}') as {
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    assert.equal(payload.usage?.input_tokens, 7);
    assert.equal(payload.usage?.output_tokens, 3);
    assert.equal(payload.usage?.cache_read_input_tokens, 0);
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
