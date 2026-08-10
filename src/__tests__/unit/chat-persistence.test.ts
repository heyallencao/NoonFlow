import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCheckpointFlusher } from '../../lib/chat/persistence';
import type { MessageContentBlock } from '../../types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('chat persistence flusher', () => {
  afterEach(async () => {
    await sleep(0);
  });

  it('flushes on threshold and finalizes with terminal status', async () => {
    let snapshot: MessageContentBlock[] = [];
    const persisted: Array<{ revision: number; isFinal: boolean; text: string; status?: string }> = [];

    const flusher = createCheckpointFlusher({
      getSnapshot: () => snapshot,
      persistSnapshot: async (entry) => {
        persisted.push({
          revision: entry.revision,
          isFinal: entry.isFinal,
          text: entry.blocks.map((block) => ('text' in block ? block.text : '')).join(''),
          status: entry.terminalStatus,
        });
      },
      flushIntervalMs: 100,
      textThresholdChars: 5,
    });

    snapshot = [{ type: 'text', text: 'he' }];
    flusher.markDirty({ textDelta: 2 });
    await sleep(20);
    assert.equal(persisted.length, 0);

    snapshot = [{ type: 'text', text: 'hello!' }];
    flusher.markDirty({ textDelta: 4 });
    await sleep(20);

    assert.deepEqual(persisted, [
      { revision: 1, isFinal: false, text: 'hello!', status: undefined },
    ]);

    snapshot = [{ type: 'text', text: 'hello world' }];
    await flusher.finalize('completed');

    assert.deepEqual(persisted, [
      { revision: 1, isFinal: false, text: 'hello!', status: undefined },
      { revision: 2, isFinal: true, text: 'hello world', status: 'completed' },
    ]);
  });

  it('serializes concurrent dirty updates and keeps the latest snapshot', async () => {
    let snapshot: MessageContentBlock[] = [{ type: 'text', text: 'first' }];
    const persisted: Array<{ revision: number; text: string; isFinal: boolean }> = [];

    const flusher = createCheckpointFlusher({
      getSnapshot: () => snapshot,
      persistSnapshot: async (entry) => {
        persisted.push({
          revision: entry.revision,
          text: entry.blocks.map((block) => ('text' in block ? block.text : '')).join(''),
          isFinal: entry.isFinal,
        });
        await sleep(30);
      },
      flushIntervalMs: 100,
      textThresholdChars: 1024,
    });

    flusher.markDirty({ immediate: true });
    await sleep(5);
    snapshot = [{ type: 'text', text: 'second' }];
    flusher.markDirty({ immediate: true });
    await flusher.finalize('completed');

    assert.deepEqual(persisted, [
      { revision: 1, text: 'first', isFinal: false },
      { revision: 2, text: 'second', isFinal: true },
    ]);
  });

  it('still finalizes after an immediate rollback produces an empty snapshot', async () => {
    let snapshot: MessageContentBlock[] = [];
    const persisted: Array<{ text: string; isFinal: boolean }> = [];
    const flusher = createCheckpointFlusher({
      getSnapshot: () => snapshot,
      persistSnapshot: async (entry) => {
        persisted.push({
          text: entry.blocks.map((block) => ('text' in block ? block.text : '')).join(''),
          isFinal: entry.isFinal,
        });
      },
    });

    flusher.markDirty({ immediate: true });
    snapshot = [{ type: 'text', text: 'recovered answer' }];
    await flusher.finalize('completed');

    assert.deepEqual(persisted, [
      { text: 'recovered answer', isFinal: true },
    ]);
  });

  it('coalesces high-frequency text deltas into bounded checkpoint writes', async () => {
    let text = '';
    let snapshot: MessageContentBlock[] = [{ type: 'text', text }];
    const persisted: Array<{ revision: number; text: string; isFinal: boolean }> = [];

    const flusher = createCheckpointFlusher({
      getSnapshot: () => snapshot,
      persistSnapshot: async (entry) => {
        persisted.push({
          revision: entry.revision,
          text: entry.blocks.map((block) => ('text' in block ? block.text : '')).join(''),
          isFinal: entry.isFinal,
        });
      },
      flushIntervalMs: 1_000,
      textThresholdChars: 32,
    });

    for (let i = 0; i < 60; i += 1) {
      text += 'abcd';
      snapshot = [{ type: 'text', text }];
      flusher.markDirty({ textDelta: 4 });
      await sleep(1);
    }

    await flusher.finalize('completed');

    assert.ok(persisted.length >= 2);
    assert.ok(persisted.length <= 12);
    assert.equal(persisted[persisted.length - 1]?.isFinal, true);
    assert.equal(persisted[persisted.length - 1]?.text, text);

    for (let i = 0; i < persisted.length; i += 1) {
      assert.equal(persisted[i]?.revision, i + 1);
    }
  });

  it('marks the flusher degraded after retries are exhausted', async () => {
    let attempts = 0;
    const flusher = createCheckpointFlusher({
      getSnapshot: () => [{ type: 'text', text: 'retry' }],
      persistSnapshot: async () => {
        attempts += 1;
        throw new Error('write failed');
      },
      flushIntervalMs: 10,
      textThresholdChars: 1,
      maxRetries: 1,
      retryDelayMs: 1,
    });

    await flusher.finalize('error');

    assert.equal(attempts, 2);
    assert.equal(flusher.isDegraded(), true);
  });
});
