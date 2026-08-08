import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-messages-route-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getMessages: typeof import('../../lib/db').getMessages;
let postMessage: typeof import('../../app/api/chat/messages/route').POST;

before(async () => {
  ({ closeDb, createSession, getMessages } = await import('../../lib/db'));
  ({ POST: postMessage } = await import('../../app/api/chat/messages/route'));
});

afterEach(() => {
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/chat/messages client_message_id', () => {
  it('persists and returns client_message_id for direct message writes', async () => {
    const session = createSession('Direct Message Write');

    const response = await postMessage(new Request('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        role: 'assistant',
        content: 'assistant reply',
        client_message_id: 'msg-123',
      }),
    }) as never);

    assert.equal(response.status, 200);
    const json = await response.json() as { message: { client_message_id?: string | null } };
    assert.equal(json.message.client_message_id, 'msg-123');

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.client_message_id, 'msg-123');
  });

  it('treats duplicate user client_message_id writes as idempotent', async () => {
    const session = createSession('Direct User Message Idempotency');

    const requestBody = {
      session_id: session.id,
      role: 'user' as const,
      content: 'user prompt',
      client_message_id: 'msg-user-123',
    };

    const firstResponse = await postMessage(new Request('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }) as never);
    const secondResponse = await postMessage(new Request('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }) as never);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);

    const firstJson = await firstResponse.json() as { message: { id: string; client_message_id?: string | null } };
    const secondJson = await secondResponse.json() as { message: { id: string; client_message_id?: string | null } };

    assert.equal(firstJson.message.id, secondJson.message.id);
    assert.equal(secondJson.message.client_message_id, 'msg-user-123');

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, firstJson.message.id);
    assert.equal(messages[0]?.content, 'user prompt');
  });

  it('rejects conflicting user content for the same client_message_id', async () => {
    const session = createSession('Direct User Message Conflict');

    const firstResponse = await postMessage(new Request('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        role: 'user',
        content: 'user prompt',
        client_message_id: 'msg-user-conflict',
      }),
    }) as never);
    const secondResponse = await postMessage(new Request('http://localhost/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        role: 'user',
        content: 'changed prompt',
        client_message_id: 'msg-user-conflict',
      }),
    }) as never);

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 409);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, 'user prompt');
    assert.equal(messages[0]?.client_message_id, 'msg-user-conflict');
  });
});
