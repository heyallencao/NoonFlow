import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseMessageContent } from '../../types';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-bridge-conversation-engine-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

let agentEventBus: typeof import('../../lib/agent-runtime/event-bus').agentEventBus;
let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getMessages: typeof import('../../lib/db').getMessages;
let getMessageParts: typeof import('../../lib/db').getMessageParts;
let consumeStream: typeof import('../../lib/bridge/conversation-engine').consumeStream;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildEvent(type: string, data: string): string {
  return `data: ${JSON.stringify({ type, data })}\n`;
}

function createScheduledStream(
  steps: Array<{ delayMs: number; chunk: string }>,
): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      void (async () => {
        for (const step of steps) {
          if (step.delayMs > 0) {
            await delay(step.delayMs);
          }
          controller.enqueue(step.chunk);
        }
        controller.close();
      })().catch((error) => {
        controller.error(error);
      });
    },
  });
}

before(async () => {
  ({ agentEventBus } = await import('../../lib/agent-runtime/event-bus'));
  ({ closeDb, createSession, getMessages, getMessageParts } = await import('../../lib/db'));
  ({ consumeStream } = await import('../../lib/bridge/conversation-engine'));
});

afterEach(() => {
  agentEventBus.clear();
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('bridge conversation engine persistence', () => {
  it('checkpoint flushes assistant parts before finalizing and reuses the same placeholder row', async () => {
    const session = createSession('Bridge Checkpoint');
    const stream = createScheduledStream([
      {
        delayMs: 0,
        chunk:
          buildEvent('text', 'Hello ')
          + buildEvent('tool_use', JSON.stringify({ id: 'tool-1', name: 'Read', input: { path: '/tmp/a.ts' } })),
      },
      {
        delayMs: 60,
        chunk:
          buildEvent('tool_result', JSON.stringify({ tool_use_id: 'tool-1', content: 'ok', is_error: false }))
          + buildEvent('text', 'world')
          + buildEvent('done', ''),
      },
    ]);

    const resultPromise = consumeStream(stream, session.id);

    await delay(30);
    const interimMessages = getMessages(session.id, { limit: 10 }).messages;
    assert.equal(interimMessages.length, 1);
    const interimAssistant = interimMessages[0]!;
    assert.equal(interimAssistant.role, 'assistant');
    assert.equal(interimAssistant.status, 'streaming');

    const interimParts = getMessageParts(interimAssistant.id);
    assert.ok(interimParts.length >= 2);
    assert.equal(interimParts[0]?.revision, 1);
    assert.equal(interimParts.some((part) => part.part_type === 'tool_use'), true);

    const result = await resultPromise;
    assert.equal(result.hasError, false);
    assert.equal(result.responseText, 'Hello world');

    const finalMessages = getMessages(session.id, { limit: 10 }).messages;
    assert.equal(finalMessages.length, 1);
    const finalAssistant = finalMessages[0]!;
    assert.equal(finalAssistant.id, interimAssistant.id);
    assert.equal(finalAssistant.status, 'completed');
    assert.ok((finalAssistant.persisted_revision ?? 0) > 1);

    const finalParts = getMessageParts(finalAssistant.id);
    assert.deepEqual(
      finalParts.map((part) => part.part_type),
      ['text', 'tool_use', 'tool_result', 'text'],
    );
    assert.equal(finalParts.every((part) => part.is_final === 1), true);
    assert.equal(
      finalParts.every((part) => part.revision === finalAssistant.persisted_revision),
      true,
    );
  });

  it('preserves reasoning to text ordering across chunked SSE boundaries', async () => {
    const session = createSession('Bridge Chunked Reasoning');
    const reasoningLine = buildEvent('reasoning', 'plan first');
    const textLine = buildEvent('text', 'final answer');
    const doneLine = buildEvent('done', '');
    const stream = createScheduledStream([
      { delayMs: 0, chunk: reasoningLine.slice(0, 14) },
      { delayMs: 10, chunk: reasoningLine.slice(14) + textLine.slice(0, 9) },
      { delayMs: 10, chunk: textLine.slice(9) + doneLine },
    ]);

    const result = await consumeStream(stream, session.id);
    assert.equal(result.hasError, false);
    assert.equal(result.responseText, 'final answer');

    const messages = getMessages(session.id, { limit: 10 }).messages;
    assert.equal(messages.length, 1);
    const assistant = messages[0]!;
    const blocks = parseMessageContent(assistant.content);

    assert.deepEqual(
      blocks.map((block) => block.type),
      ['reasoning', 'text'],
    );
    assert.equal(blocks[0]?.type, 'reasoning');
    assert.equal(blocks[1]?.type, 'text');
    assert.ok((assistant.persisted_revision ?? 0) > 1);
  });

  it('emits a typed persisted ack after reusing the assistant placeholder row', async () => {
    const session = createSession('Bridge Persisted Ack');
    const persistedEvents: Array<{
      sessionId: string;
      clientMessageId: string;
      messageId: string;
      revision: number;
      createdAt: string;
    }> = [];
    const unsubscribe = agentEventBus.on('message.assistant.persisted', (event) => {
      if (event.type !== 'message.assistant.persisted') {
        return;
      }
      persistedEvents.push({
        sessionId: event.metadata.sessionId,
        clientMessageId: event.clientMessageId,
        messageId: event.messageId,
        revision: event.revision,
        createdAt: event.createdAt,
      });
    });

    try {
      const stream = createScheduledStream([
        {
          delayMs: 0,
          chunk:
            buildEvent('text', 'Persisted ')
            + buildEvent('text', 'bridge ack')
            + buildEvent('done', ''),
        },
      ]);

      const result = await consumeStream(stream, session.id);
      assert.equal(result.hasError, false);

      const messages = getMessages(session.id, { limit: 10 }).messages;
      assert.equal(messages.length, 1);
      const assistant = messages[0]!;

      assert.deepEqual(persistedEvents, [
        {
          sessionId: session.id,
          clientMessageId: assistant.client_message_id ?? '',
          messageId: assistant.id,
          revision: assistant.persisted_revision ?? 0,
          createdAt: assistant.created_at,
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('drops placeholder assistant rows when the stream ends without any renderable content', async () => {
    const session = createSession('Bridge Empty Placeholder');
    const stream = createScheduledStream([
      {
        delayMs: 0,
        chunk:
          buildEvent('error', 'boom before first token')
          + buildEvent('done', ''),
      },
    ]);

    const result = await consumeStream(stream, session.id);
    assert.equal(result.hasError, true);

    const messages = getMessages(session.id, { limit: 10 }).messages;
    assert.equal(messages.length, 0);
  });
});
