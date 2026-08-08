/**
 * Unit tests for structured message persistence in collectStreamResponse.
 *
 * Run with: npx tsx --test src/__tests__/unit/message-persistence.test.ts
 *
 * Tests verify that:
 * 1. parseMessageContent correctly parses structured JSON content
 * 2. parseMessageContent handles plain text fallback
 * 3. MessageContentBlock types are correctly structured
 * 4. Backward compatibility: text-only messages stay as plain strings
 * 5. Mixed content (text + tool_use + tool_result) serializes correctly
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseMessageContent } from '../../types';
import type { MessageContentBlock } from '../../types';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-message-persistence-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  addMessage,
  closeDb,
  createAssistantPlaceholderMessage,
  createSession,
  getDb,
  getMessages,
  getMessageParts,
  getSession,
  replaceMessageParts,
  upsertMessageParts,
  upsertAssistantMessage,
  upsertUserMessage,
} = require('../../lib/db') as typeof import('../../lib/db');
const {
  persistAssistantTerminalStateDirect,
} = require('../../lib/chat/assistant-terminal-persistence') as typeof import('../../lib/chat/assistant-terminal-persistence');

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseMessageContent', () => {
  it('should parse plain text as a single text block', () => {
    const result = parseMessageContent('Hello, world!');
    assert.deepEqual(result, [{ type: 'text', text: 'Hello, world!' }]);
  });

  it('should parse JSON array of content blocks', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Let me check that file.' },
      { type: 'tool_use', id: 'tu_123', name: 'read_file', input: { path: '/src/index.ts' } },
    ];
    const json = JSON.stringify(blocks);
    const result = parseMessageContent(json);
    assert.deepEqual(result, blocks);
  });

  it('should handle tool_result blocks', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Reading file...' },
      { type: 'tool_use', id: 'tu_456', name: 'read_file', input: { path: '/package.json' } },
      { type: 'tool_result', tool_use_id: 'tu_456', content: '{"name": "monolith"}', is_error: false },
      { type: 'text', text: 'The package name is monolith.' },
    ];
    const json = JSON.stringify(blocks);
    const result = parseMessageContent(json);
    assert.equal(result.length, 4);
    assert.equal(result[0].type, 'text');
    assert.equal(result[1].type, 'tool_use');
    assert.equal(result[2].type, 'tool_result');
    assert.equal(result[3].type, 'text');
  });

  it('should handle error tool results', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'tool_result', tool_use_id: 'tu_789', content: 'File not found', is_error: true },
    ];
    const json = JSON.stringify(blocks);
    const result = parseMessageContent(json);
    assert.equal(result.length, 1);
    const block = result[0] as Extract<MessageContentBlock, { type: 'tool_result' }>;
    assert.equal(block.is_error, true);
  });

  it('should fall back to plain text for non-JSON content', () => {
    const content = 'This is markdown **bold** text with `code`';
    const result = parseMessageContent(content);
    assert.deepEqual(result, [{ type: 'text', text: content }]);
  });

  it('should fall back to plain text for JSON that is not an array', () => {
    const content = JSON.stringify({ key: 'value' });
    const result = parseMessageContent(content);
    assert.deepEqual(result, [{ type: 'text', text: content }]);
  });

  it('should handle empty content', () => {
    const result = parseMessageContent('');
    assert.deepEqual(result, [{ type: 'text', text: '' }]);
  });
});

describe('Structured message serialization', () => {
  it('should serialize text-only messages as plain text for backward compat', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Hello, this is a response.' },
    ];

    // Logic from collectStreamResponse: text-only → plain string
    const hasToolBlocks = blocks.some(
      (b) => b.type === 'tool_use' || b.type === 'tool_result'
    );
    assert.equal(hasToolBlocks, false);

    const content = blocks
      .filter((b): b is Extract<MessageContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    assert.equal(content, 'Hello, this is a response.');
    // parseMessageContent should handle it as plain text
    const parsed = parseMessageContent(content);
    assert.deepEqual(parsed, [{ type: 'text', text: 'Hello, this is a response.' }]);
  });

  it('should serialize mixed content as JSON', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Let me read that.' },
      { type: 'tool_use', id: 'tu_001', name: 'read_file', input: { path: '/src/app.ts' } },
      { type: 'tool_result', tool_use_id: 'tu_001', content: 'export default {};', is_error: false },
      { type: 'text', text: 'The file exports a default empty object.' },
    ];

    const hasToolBlocks = blocks.some(
      (b) => b.type === 'tool_use' || b.type === 'tool_result'
    );
    assert.equal(hasToolBlocks, true);

    const content = JSON.stringify(blocks);
    // Should round-trip correctly
    const parsed = parseMessageContent(content);
    assert.equal(parsed.length, 4);
    assert.equal(parsed[0].type, 'text');
    assert.equal(parsed[1].type, 'tool_use');
    assert.equal(parsed[2].type, 'tool_result');
    assert.equal(parsed[3].type, 'text');
  });

  it('should handle multiple text blocks being flushed around tool calls', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'First I will check the file structure.' },
      { type: 'tool_use', id: 'tu_a', name: 'list_files', input: { dir: '.' } },
      { type: 'tool_result', tool_use_id: 'tu_a', content: 'src/\npackage.json', is_error: false },
      { type: 'text', text: 'Now let me read package.json.' },
      { type: 'tool_use', id: 'tu_b', name: 'read_file', input: { path: 'package.json' } },
      { type: 'tool_result', tool_use_id: 'tu_b', content: '{"name":"test"}', is_error: false },
      { type: 'text', text: 'Done! The project is named "test".' },
    ];

    const content = JSON.stringify(blocks);
    const parsed = parseMessageContent(content);
    assert.equal(parsed.length, 7);

    // Verify interleaved structure is preserved
    const types = parsed.map((b) => b.type);
    assert.deepEqual(types, [
      'text', 'tool_use', 'tool_result',
      'text', 'tool_use', 'tool_result',
      'text',
    ]);
  });
});

describe('message DB persistence', () => {
  it('stores and reads back client_message_id', () => {
    const session = createSession('Client Message ID');
    const stored = addMessage(session.id, 'assistant', 'persisted reply', null, 'msg-123');

    assert.equal(stored.client_message_id, 'msg-123');

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.client_message_id, 'msg-123');
  });

  it('defaults client_message_id to null when omitted', () => {
    const session = createSession('Legacy Message');
    const stored = addMessage(session.id, 'assistant', 'legacy reply');

    assert.equal(stored.client_message_id ?? null, null);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.client_message_id ?? null, null);
  });

  it('reuses the same assistant row when placeholder is finalized by client_message_id', () => {
    const session = createSession('Assistant Placeholder');
    const placeholder = createAssistantPlaceholderMessage(session.id, 'msg-200');

    assert.equal(placeholder.client_message_id, 'msg-200');
    assert.equal(placeholder.status, 'streaming');

    const finalized = upsertAssistantMessage(
      session.id,
      'msg-200',
      'final assistant reply',
      null,
      {
        status: 'completed',
        contentFormatVersion: 2,
        completedAt: '2026-03-20 10:00:00',
        persistedRevision: 1,
      },
    );

    assert.equal(finalized.id, placeholder.id);
    assert.equal(finalized.content, 'final assistant reply');
    assert.equal(finalized.status, 'completed');
    assert.equal(finalized.persisted_revision, 1);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, placeholder.id);
    assert.equal(messages[0]?.content, 'final assistant reply');
    assert.equal(messages[0]?.client_message_id, 'msg-200');
    assert.equal(messages[0]?.status, 'completed');
  });

  it('resets a failed assistant placeholder in place before retrying', () => {
    const session = createSession('Assistant Placeholder Retry');
    const placeholder = createAssistantPlaceholderMessage(session.id, 'msg-retry');

    replaceMessageParts(placeholder.id, session.id, [
      { partType: 'text', content: 'stale partial reply', metadata: null },
    ]);
    upsertAssistantMessage(
      session.id,
      'msg-retry',
      'stale partial reply',
      JSON.stringify({ input_tokens: 2, output_tokens: 3 }),
      {
        status: 'error',
        contentFormatVersion: 2,
        completedAt: '2026-03-20 10:00:00',
        persistedRevision: 1,
      },
    );

    const retried = createAssistantPlaceholderMessage(session.id, 'msg-retry');

    assert.equal(retried.id, placeholder.id);
    assert.equal(retried.status, 'streaming');
    assert.equal(retried.content, '');
    assert.equal(retried.token_usage, null);
    assert.equal(retried.completed_at, null);
    assert.equal(retried.persisted_revision, 0);

    const parts = getMessageParts(placeholder.id);
    assert.equal(parts.length, 0);
  });

  it('reuses the same user row when the same client_message_id is written again', () => {
    const session = createSession('User Message Upsert');
    const first = upsertUserMessage(session.id, 'user-msg-1', 'first prompt');
    const second = upsertUserMessage(session.id, 'user-msg-1', 'first prompt');

    assert.equal(second.id, first.id);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, first.id);
    assert.equal(messages[0]?.client_message_id, 'user-msg-1');
    assert.equal(messages[0]?.content, 'first prompt');
  });

  it('rejects conflicting user content for the same client_message_id', () => {
    const session = createSession('User Message Conflict');
    upsertUserMessage(session.id, 'user-msg-conflict', 'original prompt');

    assert.throws(
      () => upsertUserMessage(session.id, 'user-msg-conflict', 'mutated prompt'),
      /already bound to different user content/,
    );

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.content, 'original prompt');
  });

  it('persists terminal assistant state directly and returns a persisted ack', () => {
    const session = createSession('Assistant Terminal Persistence');
    const placeholder = createAssistantPlaceholderMessage(session.id, 'msg-terminal');

    const persisted = persistAssistantTerminalStateDirect({
      sessionId: session.id,
      messageId: placeholder.id,
      clientMessageId: 'msg-terminal',
      blocks: [
        { type: 'text', text: 'final answer' },
        { type: 'reasoning', text: 'thought path' },
      ],
      tokenUsage: {
        input_tokens: 11,
        output_tokens: 7,
        cache_read_input_tokens: 0,
      },
      terminalStatus: 'completed',
      revision: 3,
    });

    assert.equal(persisted.message_id, placeholder.id);
    assert.equal(persisted.client_message_id, 'msg-terminal');
    assert.equal(persisted.revision, 3);

    const { messages } = getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, placeholder.id);
    assert.equal(messages[0]?.status, 'completed');
    assert.equal(messages[0]?.persisted_revision, 3);
    assert.match(messages[0]?.content || '', /final answer/);
    assert.match(messages[0]?.content || '', /thought path/);

    const parts = getMessageParts(placeholder.id);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.revision, 3);
    assert.equal(parts[1]?.revision, 3);
    assert.equal(parts[0]?.is_final, 1);
    assert.equal(parts[1]?.is_final, 1);
  });

  it('bumps session updated_at when a placeholder is finalized in-place', () => {
    const session = createSession('Assistant Timestamp Refresh');
    const placeholder = createAssistantPlaceholderMessage(session.id, 'msg-ts');
    const db = getDb();
    const oldTimestamp = '2000-01-01 00:00:00';
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(oldTimestamp, session.id);

    persistAssistantTerminalStateDirect({
      sessionId: session.id,
      messageId: placeholder.id,
      clientMessageId: 'msg-ts',
      blocks: [{ type: 'text', text: 'completed reply' }],
      terminalStatus: 'completed',
      revision: 1,
    });

    assert.notEqual(getSession(session.id)?.updated_at, oldTimestamp);
  });

  it('upserts v2 message parts by part_key and prunes stale parts on final compaction', () => {
    const session = createSession('Message Parts Upsert');
    const message = addMessage(session.id, 'assistant', '', null, 'msg-300', {
      status: 'streaming',
      contentFormatVersion: 2,
      persistedRevision: 0,
    });

    upsertMessageParts(message.id, session.id, [
      { partType: 'text', content: 'hello', partKey: 'text:0', partIndex: 0, revision: 1, isFinal: false },
      { partType: 'tool_use', content: '{"path":"/tmp/a.ts"}', metadata: { id: 'tool-1', name: 'Read' }, partKey: 'tool_use:tool-1', partIndex: 1, revision: 1, isFinal: false },
    ]);

    upsertMessageParts(message.id, session.id, [
      { partType: 'text', content: 'hello world', partKey: 'text:0', partIndex: 0, revision: 2, isFinal: true },
    ], { pruneMissingPartKeys: true });

    const parts = getMessageParts(message.id);
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.part_key, 'text:0');
    assert.equal(parts[0]?.content, 'hello world');
    assert.equal(parts[0]?.revision, 2);
    assert.equal(parts[0]?.is_final, 1);
  });
});
