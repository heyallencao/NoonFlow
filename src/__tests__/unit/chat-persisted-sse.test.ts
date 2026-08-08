import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { appendPersistedAckEvent, wrapStreamWithSSEEvents } from '../../lib/chat/persisted-sse';

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
