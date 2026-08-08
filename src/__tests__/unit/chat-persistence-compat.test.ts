import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { MessageContentBlock } from '../../types';
import { serializeMessageContentBlocks } from '../../lib/message-content';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-chat-persistence-compat-'));
const dbPath = path.join(tmpDir, 'noonflow.db');
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let addMessage: typeof import('../../lib/db').addMessage;
let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getDb: typeof import('../../lib/db').getDb;
let getMessages: typeof import('../../lib/db').getMessages;

function resetDatabase(): void {
  if (closeDb) {
    closeDb();
  }
  fs.rmSync(dbPath, { force: true });
}

function seedLegacyDatabase(): void {
  resetDatabase();

  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      working_directory TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE message_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      part_type TEXT NOT NULL CHECK(part_type IN ('text', 'tool_use', 'tool_result')),
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
  `);

  legacyDb.prepare(
    'INSERT INTO chat_sessions (id, title, created_at, updated_at, working_directory) VALUES (?, ?, ?, ?, ?)'
  ).run('legacy-session', 'Legacy Session', '2026-03-19 12:00:00', '2026-03-19 12:00:00', '');

  legacyDb.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('legacy-message', 'legacy-session', 'assistant', 'stale legacy content', '2026-03-19 12:00:01');

  const insertPart = legacyDb.prepare(
    'INSERT INTO message_parts (session_id, message_id, part_type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertPart.run('legacy-session', 'legacy-message', 'text', 'Legacy hello. ', null, 1);
  insertPart.run(
    'legacy-session',
    'legacy-message',
    'tool_use',
    JSON.stringify({ path: '/tmp/demo.ts' }),
    JSON.stringify({ id: 'tool-legacy', name: 'Read' }),
    2,
  );
  insertPart.run(
    'legacy-session',
    'legacy-message',
    'tool_result',
    'file body',
    JSON.stringify({ tool_use_id: 'tool-legacy', is_error: false }),
    3,
  );

  legacyDb.close();
}

before(async () => {
  ({ addMessage, closeDb, createSession, getDb, getMessages } = await import('../../lib/db'));
});

afterEach(() => {
  if (closeDb) {
    closeDb();
  }
});

after(() => {
  if (closeDb) {
    closeDb();
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('chat persistence compat', () => {
  it('migrates legacy schema additively and preserves replay for old records', () => {
    seedLegacyDatabase();

    const db = getDb();
    const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;
    const messagePartColumns = db.prepare('PRAGMA table_info(message_parts)').all() as Array<{ name: string }>;
    const messagePartIndexes = db.prepare('PRAGMA index_list(message_parts)').all() as Array<{
      name: string;
      unique: number;
    }>;

    assert.ok(messageColumns.some((column) => column.name === 'status'));
    assert.ok(messageColumns.some((column) => column.name === 'content_format_version'));
    assert.ok(messageColumns.some((column) => column.name === 'completed_at'));
    assert.ok(messageColumns.some((column) => column.name === 'persisted_revision'));

    assert.ok(messagePartColumns.some((column) => column.name === 'part_key'));
    assert.ok(messagePartColumns.some((column) => column.name === 'part_index'));
    assert.ok(messagePartColumns.some((column) => column.name === 'revision'));
    assert.ok(messagePartColumns.some((column) => column.name === 'is_final'));
    assert.ok(messagePartColumns.some((column) => column.name === 'updated_at'));
    assert.ok(
      messagePartIndexes.some((index) => index.name === 'idx_message_parts_message_id_part_key' && index.unique === 1),
    );
    const messageIndexes = db.prepare('PRAGMA index_list(messages)').all() as Array<{ name: string; unique: number }>;
    assert.ok(
      messageIndexes.some((index) => index.name === 'idx_messages_session_role_client_id' && index.unique === 1),
    );

    const expectedBlocks: MessageContentBlock[] = [
      { type: 'text', text: 'Legacy hello. ' },
      { type: 'tool_use', id: 'tool-legacy', name: 'Read', input: { path: '/tmp/demo.ts' } },
      { type: 'tool_result', tool_use_id: 'tool-legacy', content: 'file body', is_error: false },
    ];

    const { messages } = getMessages('legacy-session', { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, serializeMessageContentBlocks(expectedBlocks));
  });

  it('deduplicates legacy assistant rows by keeping the more complete record and merging message parts', () => {
    resetDatabase();

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        working_directory TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        client_message_id TEXT,
        status TEXT,
        content_format_version INTEGER,
        completed_at TEXT,
        persisted_revision INTEGER,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE message_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        part_type TEXT NOT NULL CHECK(part_type IN ('text', 'reasoning', 'tool_use', 'tool_result')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        part_key TEXT,
        part_index INTEGER,
        revision INTEGER,
        is_final INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);

    legacyDb.prepare(
      'INSERT INTO chat_sessions (id, title, created_at, updated_at, working_directory) VALUES (?, ?, ?, ?, ?)'
    ).run('dup-session', 'Duplicate Session', '2026-03-19 12:00:00', '2026-03-19 12:00:00', '');
    legacyDb.prepare(
      `INSERT INTO messages (
        id,
        session_id,
        role,
        content,
        created_at,
        client_message_id,
        status,
        content_format_version,
        completed_at,
        persisted_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'assistant-1',
      'dup-session',
      'assistant',
      'final draft',
      '2026-03-19 12:00:01',
      'msg-dup',
      'completed',
      2,
      '2026-03-19 12:00:03',
      5,
    );
    legacyDb.prepare(
      `INSERT INTO messages (
        id,
        session_id,
        role,
        content,
        created_at,
        client_message_id,
        status,
        content_format_version,
        completed_at,
        persisted_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'assistant-2',
      'dup-session',
      'assistant',
      '',
      '2026-03-19 12:00:02',
      'msg-dup',
      'streaming',
      2,
      null,
      1,
    );

    const insertPart = legacyDb.prepare(
      `INSERT INTO message_parts (
        session_id,
        message_id,
        part_type,
        content,
        metadata,
        created_at,
        part_key,
        part_index,
        revision,
        is_final,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertPart.run('dup-session', 'assistant-2', 'text', 'streaming draft', null, 1, 'text:0', 0, 1, 0, 1);
    insertPart.run('dup-session', 'assistant-1', 'text', 'final draft', null, 2, 'text:0', 0, 5, 1, 2);
    insertPart.run('dup-session', 'assistant-2', 'reasoning', 'keep merged reasoning', null, 3, 'reasoning:0', 1, 1, 0, 3);

    legacyDb.close();

    const db = getDb();
    const rows = db.prepare(
      `SELECT
        id,
        content,
        client_message_id,
        status,
        persisted_revision
      FROM messages
      WHERE session_id = ?
      ORDER BY rowid ASC`
    ).all('dup-session') as Array<{
      id: string;
      content: string;
      client_message_id: string | null;
      status: string | null;
      persisted_revision: number | null;
    }>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'assistant-1');
    assert.equal(rows[0]?.content, 'final draft');
    assert.equal(rows[0]?.status, 'completed');
    assert.equal(rows[0]?.persisted_revision, 5);
    assert.equal(rows[0]?.client_message_id, 'msg-dup');

    const mergedParts = db.prepare(
      'SELECT message_id, part_key, content, revision, is_final FROM message_parts WHERE message_id = ? ORDER BY part_index ASC, id ASC'
    ).all('assistant-1') as Array<{
      message_id: string;
      part_key: string | null;
      content: string;
      revision: number | null;
      is_final: number | null;
    }>;

    assert.deepEqual(
      mergedParts.map((part) => ({
        message_id: part.message_id,
        part_key: part.part_key,
        content: part.content,
        revision: part.revision,
        is_final: part.is_final,
      })),
      [
        {
          message_id: 'assistant-1',
          part_key: 'text:0',
          content: 'final draft',
          revision: 5,
          is_final: 1,
        },
        {
          message_id: 'assistant-1',
          part_key: 'reasoning:0',
          content: 'keep merged reasoning',
          revision: 1,
          is_final: 0,
        },
      ],
    );
  });

  it('prefers v2 message_parts replay over legacy content and legacy parts', () => {
    resetDatabase();

    const session = createSession('V2 Read Preference');
    const message = addMessage(session.id, 'assistant', 'legacy row content');
    const db = getDb();
    const insertPart = db.prepare(
      `INSERT INTO message_parts (
        session_id,
        message_id,
        part_type,
        content,
        metadata,
        created_at,
        part_key,
        part_index,
        revision,
        is_final,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertPart.run(session.id, message.id, 'text', 'legacy part content', null, 1, null, null, null, null, null);
    insertPart.run(session.id, message.id, 'reasoning', 'thinking', null, 2, 'reasoning:0', 0, 3, 1, 1002);
    insertPart.run(session.id, message.id, 'text', 'final answer', null, 3, 'text:0', 1, 3, 1, 1003);

    const expectedBlocks: MessageContentBlock[] = [
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'final answer' },
    ];

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, serializeMessageContentBlocks(expectedBlocks));
  });

  it('falls back to legacy replay when v2 parts are still streaming', () => {
    resetDatabase();

    const session = createSession('Streaming Fallback');
    const message = addMessage(
      session.id,
      'assistant',
      'legacy terminal content',
      null,
      null,
      { status: 'streaming' },
    );
    const db = getDb();
    const insertPart = db.prepare(
      `INSERT INTO message_parts (
        session_id,
        message_id,
        part_type,
        content,
        metadata,
        created_at,
        part_key,
        part_index,
        revision,
        is_final,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertPart.run(session.id, message.id, 'text', 'legacy terminal content', null, 1, null, null, null, null, null);
    insertPart.run(session.id, message.id, 'text', 'partial streaming content', null, 2, 'text:0', 0, 1, 0, 1002);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, 'legacy terminal content');
  });
});
