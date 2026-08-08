import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-session-messages-route-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

let addMessage: typeof import('../../lib/db').addMessage;
let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getMessagesRoute: typeof import('../../app/api/chat/sessions/[id]/messages/route').GET;

before(async () => {
  ({ addMessage, closeDb, createSession } = await import('../../lib/db'));
  ({ GET: getMessagesRoute } = await import('../../app/api/chat/sessions/[id]/messages/route'));
});

afterEach(() => {
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/chat/sessions/[id]/messages client_message_id', () => {
  it('returns mixed legacy and client_message_id-backed messages', async () => {
    const session = createSession('Mixed Message Readback');
    addMessage(session.id, 'assistant', 'legacy reply');
    addMessage(session.id, 'assistant', 'new reply', null, 'msg-123');

    const response = await getMessagesRoute(
      new Request(`http://localhost/api/chat/sessions/${session.id}/messages?limit=10`) as never,
      { params: Promise.resolve({ id: session.id }) },
    );

    assert.equal(response.status, 200);
    const json = await response.json() as {
      messages: Array<{ content: string; client_message_id?: string | null }>;
      hasMore?: boolean;
    };

    assert.equal(json.hasMore ?? false, false);
    assert.deepEqual(
      json.messages.map((message) => ({
        content: message.content,
        client_message_id: message.client_message_id ?? null,
      })),
      [
        { content: 'legacy reply', client_message_id: null },
        { content: 'new reply', client_message_id: 'msg-123' },
      ],
    );
  });

  it('keeps pagination stable with mixed client_message_id values', async () => {
    const session = createSession('Paged Message Readback');
    addMessage(session.id, 'assistant', 'first legacy');
    addMessage(session.id, 'assistant', 'second new', null, 'msg-2');
    addMessage(session.id, 'assistant', 'third legacy');

    const firstPageResponse = await getMessagesRoute(
      new Request(`http://localhost/api/chat/sessions/${session.id}/messages?limit=2`) as never,
      { params: Promise.resolve({ id: session.id }) },
    );

    assert.equal(firstPageResponse.status, 200);
    const firstPage = await firstPageResponse.json() as {
      messages: Array<{ content: string; client_message_id?: string | null; _rowid?: number }>;
      hasMore?: boolean;
    };

    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(
      firstPage.messages.map((message) => ({
        content: message.content,
        client_message_id: message.client_message_id ?? null,
      })),
      [
        { content: 'second new', client_message_id: 'msg-2' },
        { content: 'third legacy', client_message_id: null },
      ],
    );

    const before = firstPage.messages[0]?._rowid;
    assert.ok(before);

    const secondPageResponse = await getMessagesRoute(
      new Request(`http://localhost/api/chat/sessions/${session.id}/messages?limit=2&before=${before}`) as never,
      { params: Promise.resolve({ id: session.id }) },
    );

    assert.equal(secondPageResponse.status, 200);
    const secondPage = await secondPageResponse.json() as {
      messages: Array<{ content: string; client_message_id?: string | null }>;
      hasMore?: boolean;
    };

    assert.equal(secondPage.hasMore ?? false, false);
    assert.deepEqual(
      secondPage.messages.map((message) => ({
        content: message.content,
        client_message_id: message.client_message_id ?? null,
      })),
      [{ content: 'first legacy', client_message_id: null }],
    );
  });
});
