import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let addMessage: typeof import('../../lib/db').addMessage;
let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getDb: typeof import('../../lib/db').getDb;
let replaceMessageParts: typeof import('../../lib/db').replaceMessageParts;
let upsertMessageParts: typeof import('../../lib/db').upsertMessageParts;
let buildMessagePartInputs: typeof import('../../lib/message-content').buildMessagePartInputs;
let formatReplayValidationReport: typeof import('../../lib/chat/replay-validator').formatReplayValidationReport;
let formatReplaySampleValidationReport: typeof import('../../lib/chat/replay-validator').formatReplaySampleValidationReport;
let validateSampledSessionReplays: typeof import('../../lib/chat/replay-validator').validateSampledSessionReplays;
let validateSessionReplay: typeof import('../../lib/chat/replay-validator').validateSessionReplay;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-replay-validator-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

before(async () => {
  ({
    addMessage,
    closeDb,
    createSession,
    getDb,
    replaceMessageParts,
    upsertMessageParts,
  } = await import('../../lib/db'));
  ({ buildMessagePartInputs } = await import('../../lib/message-content'));
  ({
    formatReplaySampleValidationReport,
    formatReplayValidationReport,
    validateSampledSessionReplays,
    validateSessionReplay,
  } = await import('../../lib/chat/replay-validator'));
});

afterEach(() => {
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('chat replay validator', () => {
  it('reports mixed legacy/v2 equivalence, mismatches, and streaming skips', () => {
    const session = createSession('Replay Validator');
    const updatedAt = Date.now();

    const equivalent = addMessage(session.id, 'assistant', 'same reply', null, 'msg-1', {
      status: 'completed',
      contentFormatVersion: 2,
      persistedRevision: 1,
    });
    replaceMessageParts(equivalent.id, session.id, [
      { partType: 'text', content: 'same reply', metadata: null },
    ]);
    upsertMessageParts(
      equivalent.id,
      session.id,
      buildMessagePartInputs(
        [{ type: 'text', text: 'same reply' }],
        { includeStableKeys: true, revision: 1, isFinal: true, updatedAt },
      ),
    );

    const mismatch = addMessage(session.id, 'assistant', 'legacy reply', null, 'msg-2', {
      status: 'completed',
      contentFormatVersion: 2,
      persistedRevision: 1,
    });
    replaceMessageParts(mismatch.id, session.id, [
      { partType: 'text', content: 'legacy reply', metadata: null },
    ]);
    upsertMessageParts(
      mismatch.id,
      session.id,
      buildMessagePartInputs(
        [{ type: 'text', text: 'v2 reply' }],
        { includeStableKeys: true, revision: 1, isFinal: true, updatedAt },
      ),
    );

    const streaming = addMessage(session.id, 'assistant', 'legacy fallback', null, 'msg-3', {
      status: 'streaming',
      contentFormatVersion: 2,
      persistedRevision: 1,
    });
    replaceMessageParts(streaming.id, session.id, [
      { partType: 'text', content: 'legacy fallback', metadata: null },
    ]);
    upsertMessageParts(
      streaming.id,
      session.id,
      buildMessagePartInputs(
        [{ type: 'text', text: 'partial v2' }],
        { includeStableKeys: true, revision: 1, isFinal: false, updatedAt },
      ),
    );

    const report = validateSessionReplay(session.id);

    assert.equal(report.messageCount, 3);
    assert.equal(report.comparableMessageCount, 3);
    assert.equal(report.skippedStreamingMessageCount, 1);
    assert.equal(report.mismatchCount, 1);

    const equivalentReport = report.messages.find((message) => message.messageId === equivalent.id);
    const mismatchReport = report.messages.find((message) => message.messageId === mismatch.id);
    const streamingReport = report.messages.find((message) => message.messageId === streaming.id);

    assert.ok(equivalentReport);
    assert.equal(equivalentReport!.hasMismatch, false);

    assert.ok(mismatchReport);
    assert.equal(mismatchReport!.hasMismatch, true);
    assert.equal(
      mismatchReport!.comparisons.some((comparison) => (
        comparison.left === 'v2_parts' && comparison.right === 'legacy_parts' && !comparison.matches
      ) || (
        comparison.left === 'legacy_parts' && comparison.right === 'v2_parts' && !comparison.matches
      )),
      true,
    );

    assert.ok(streamingReport);
    assert.equal(streamingReport!.skippedStrictMismatchCheck, true);
    assert.equal(streamingReport!.hasMismatch, false);

    const formatted = formatReplayValidationReport(report);
    assert.match(formatted, /mismatches=1/);
    assert.match(formatted, new RegExp(`mismatch message=${mismatch.id}`));
  });

  it('supports sampled replay validation with session filters', () => {
    const db = getDb();
    const updatedAt = Date.now();
    const oldChat = createSession('Sample Old Chat');
    const recentChat = createSession('Sample Recent Chat');
    const recentTerminal = createSession(
      'Sample Recent Terminal',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'terminal',
    );
    const emptyRecentChat = createSession('Sample Empty Recent Chat');

    addMessage(oldChat.id, 'assistant', 'old reply');
    const mismatch = addMessage(recentChat.id, 'assistant', 'legacy reply', null, 'sample-mismatch', {
      status: 'completed',
      contentFormatVersion: 2,
      persistedRevision: 2,
    });
    replaceMessageParts(mismatch.id, recentChat.id, [
      { partType: 'text', content: 'legacy reply', metadata: null },
    ]);
    upsertMessageParts(
      mismatch.id,
      recentChat.id,
      buildMessagePartInputs(
        [{ type: 'text', text: 'v2 mismatch reply' }],
        { includeStableKeys: true, revision: 2, isFinal: true, updatedAt },
      ),
    );
    addMessage(recentTerminal.id, 'assistant', 'terminal reply');

    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run('2026-03-10 00:00:00', oldChat.id);
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run('2026-03-21 09:00:00', recentChat.id);
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run('2026-03-21 10:00:00', recentTerminal.id);
    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run('2026-03-21 11:00:00', emptyRecentChat.id);

    const sampled = validateSampledSessionReplays({
      sampleSize: 10,
      sinceUpdatedAt: '2026-03-21 00:00:00',
      sessionType: 'chat',
    });

    assert.equal(sampled.sampleSize, 10);
    assert.equal(sampled.selectedSessionCount >= 1, true);
    assert.equal(sampled.sessions.some((entry) => entry.sessionId === recentChat.id), true);
    assert.equal(sampled.sessions.some((entry) => entry.sessionType === 'terminal'), false);
    assert.equal(sampled.sessions.some((entry) => entry.sessionId === emptyRecentChat.id), false);
    const recentChatReport = sampled.sessions.find((entry) => entry.sessionId === recentChat.id);
    assert.ok(recentChatReport);
    assert.equal(recentChatReport.mismatchCount, 1);

    const formatted = formatReplaySampleValidationReport(sampled);
    assert.match(formatted, /sample_size=10/);
    assert.match(formatted, /selected_sessions=\d+/);
    assert.match(formatted, /mismatches=\d+/);
    assert.match(formatted, new RegExp(`mismatch session=${recentChat.id}`));
  });
});
