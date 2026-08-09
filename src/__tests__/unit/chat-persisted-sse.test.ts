import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appendPersistedAckEvent, wrapStreamWithHeartbeat, wrapStreamWithSSEEvents } from '../../lib/chat/persisted-sse';

function createStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    output += value;
  }

  return output;
}

describe('chat persisted SSE helper', () => {
  it('emits heartbeat while the source is silent and stops immediately on abort', async () => {
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    let tick: (() => void) | null = null;
    let cancelled = 0;
    const abortController = new AbortController();
    global.setInterval = (((handler: TimerHandler) => {
      tick = () => typeof handler === 'function' && handler();
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown) as typeof global.setInterval;
    global.clearInterval = (() => undefined) as typeof global.clearInterval;

    try {
      const source = new ReadableStream<string>({
        cancel() {
          cancelled += 1;
        },
      });
      const reader = wrapStreamWithHeartbeat(source, {
        intervalMs: 10,
        signal: abortController.signal,
      }).getReader();

      if (!tick) throw new Error('heartbeat timer was not registered');
      const triggerHeartbeat = tick as unknown as () => void;
      triggerHeartbeat();
      const first = await reader.read();
      assert.equal(first.done, false);
      assert.match(first.value ?? '', /"type":"runtime\.heartbeat"/);

      abortController.abort();
      const done = await reader.read();
      assert.equal(done.done, true);
      assert.equal(cancelled, 1);
    } finally {
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  });

  it('stops heartbeat scheduling immediately on runtime error and source completion', async () => {
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    let cleared = 0;
    global.setInterval = ((() => 2 as unknown as ReturnType<typeof setInterval>) as unknown) as typeof global.setInterval;
    global.clearInterval = (() => { cleared += 1; }) as typeof global.clearInterval;

    try {
      let errorSourceCancelled = 0;
      const abortController = new AbortController();
      const errorSource = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'error', data: 'runtime failed' })}\n\n`);
        },
        cancel() {
          errorSourceCancelled += 1;
        },
      });
      const errorReader = wrapStreamWithHeartbeat(errorSource, {
        intervalMs: 10,
        signal: abortController.signal,
      }).getReader();
      const errorEvent = await errorReader.read();
      assert.match(errorEvent.value ?? '', /"type":"error"/);
      assert.equal(cleared, 1);
      abortController.abort();
      assert.equal((await errorReader.read()).done, true);
      assert.equal(errorSourceCancelled, 1);

      await readStream(wrapStreamWithHeartbeat(createStream([]), { intervalMs: 10 }));
      assert.equal(cleared, 2);
    } finally {
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  });
  it('prepends lifecycle events before the source stream and appends terminal events after it', async () => {
    const output = await readStream(wrapStreamWithSSEEvents(
      createStream([
        `data: ${JSON.stringify({ type: 'text', data: 'hello' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
      ]),
      {
        prependEvents: [
          {
            type: 'user_persisted',
            data: JSON.stringify({
              session_id: 'session-1',
              client_message_id: 'msg-123',
              message_id: 'db-user-1',
              created_at: '2026-03-20 11:59:59',
            }),
          },
        ],
        appendEventPromises: [
          Promise.resolve({
            type: 'persisted',
            data: JSON.stringify({
              session_id: 'session-1',
              client_message_id: 'msg-123',
              message_id: 'db-assistant-1',
              revision: 2,
              created_at: '2026-03-20 12:00:00',
            }),
          }),
        ],
      },
    ));

    const events = output
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')) as { type: string; data: string });

    assert.deepEqual(events.map((event) => event.type), [
      'user_persisted',
      'text',
      'done',
      'persisted',
    ]);
  });

  it('appends a persisted event after the source stream finishes', async () => {
    const output = await readStream(appendPersistedAckEvent(
      createStream([
        `data: ${JSON.stringify({ type: 'text', data: 'hello' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
      ]),
      Promise.resolve({
        session_id: 'session-1',
        client_message_id: 'msg-123',
        message_id: 'db-msg-1',
        revision: 2,
        created_at: '2026-03-20 12:00:00',
      }),
    ));

    const events = output
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')) as { type: string; data: string });

    assert.equal(events.length, 3);
    assert.equal(events[0]?.type, 'text');
    assert.equal(events[1]?.type, 'done');
    assert.equal(events[2]?.type, 'persisted');

    const persistedPayload = JSON.parse(events[2]!.data) as {
      session_id: string;
      client_message_id: string;
      message_id: string;
      revision: number;
      created_at: string;
    };
    assert.deepEqual(persistedPayload, {
      session_id: 'session-1',
      client_message_id: 'msg-123',
      message_id: 'db-msg-1',
      revision: 2,
      created_at: '2026-03-20 12:00:00',
    });
  });

  it('does not append anything when the persisted ack resolves to null', async () => {
    const output = await readStream(appendPersistedAckEvent(
      createStream([
        `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
      ]),
      Promise.resolve(null),
    ));

    const events = output
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.replace(/^data:\s*/, '')) as { type: string });

    assert.deepEqual(events, [{ type: 'done', data: '' }]);
  });
});
