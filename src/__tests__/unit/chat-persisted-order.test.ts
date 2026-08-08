import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { consumeSSEStream } from '../../hooks/useSSEStream';
import { appendPersistedAckEvent } from '../../lib/chat/persisted-sse';

function createStringStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function toByteReader(stream: ReadableStream<string>): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          controller.enqueue(encoder.encode(value));
        }
        controller.close();
      })().catch((error) => {
        controller.error(error);
      });
    },
  }).getReader();
}

describe('completed/persisted ordering', () => {
  it('delivers persisted ack through the full helper plus SSE consumer chain after done', async () => {
    const sequence: string[] = [];

    await consumeSSEStream(
      toByteReader(appendPersistedAckEvent(
        createStringStream([
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
      )),
      {
        onText: (accumulated) => {
          sequence.push(`text:${accumulated}`);
        },
        onReasoning: () => {},
        onToolUse: () => {},
        onToolResult: () => {},
        onToolOutput: () => {},
        onToolProgress: () => {},
        onStatus: () => {},
        onResult: () => {},
        onPermissionRequest: () => {},
        onToolTimeout: () => {},
        onModeChanged: () => {},
        onTaskUpdate: () => {},
        onUserPersisted: () => {},
        onAssistantPersisted: (data) => {
          sequence.push(`persisted:${data.message_id}:${data.revision}`);
        },
        onError: () => {},
      },
      {
        sessionId: 'session-1',
        source: 'sdk',
        emitToEventBus: false,
      },
    );

    assert.deepEqual(sequence, [
      'text:hello',
      'persisted:db-msg-1:2',
    ]);
  });
});
