import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  appendCodexDelta,
  buildCodexThreadStartedStatusEvent,
  extractCodexItemEnvelope,
} from '../../lib/codex/event-mapper';

describe('codex event mapper', () => {
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
