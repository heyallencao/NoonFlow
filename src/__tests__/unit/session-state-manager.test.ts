import { before, describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-session-state-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
// Keep tests hermetic: avoid migrating a developer's local database into the fixture.
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

let createSession: typeof import('../../lib/db').createSession;
let createPermissionRequest: typeof import('../../lib/db').createPermissionRequest;
let getActiveSessions: typeof import('../../lib/db').getActiveSessions;
let getSession: typeof import('../../lib/db').getSession;
let getMessages: typeof import('../../lib/db').getMessages;
let getMessageParts: typeof import('../../lib/db').getMessageParts;
let getSessionRuntimeState: typeof import('../../lib/db').getSessionRuntimeState;
let addMessage: typeof import('../../lib/db').addMessage;
let upsertMessageParts: typeof import('../../lib/db').upsertMessageParts;
let upsertSessionRuntimeState: typeof import('../../lib/db').upsertSessionRuntimeState;
let closeDb: typeof import('../../lib/db').closeDb;
let sessionStateManager: typeof import('../../lib/session-state-manager').sessionStateManager;

before(async () => {
  ({
    createSession,
    createPermissionRequest,
    getActiveSessions,
    getSession,
    getMessages,
    getMessageParts,
    getSessionRuntimeState,
    addMessage,
    upsertMessageParts,
    upsertSessionRuntimeState,
    closeDb,
  } = await import('../../lib/db'));
  ({ sessionStateManager } = await import('../../lib/session-state-manager'));
});

describe('SessionStateManager', () => {
  afterEach(() => {
    closeDb();
  });

  it('updates sdk session, cwd, and runtime state through one entry point', () => {
    const session = createSession('State Test', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      sdkSessionId: 'sdk-123',
      sdkCwd: '/tmp/workspace',
      runtimeStatus: 'running',
      runtimeError: '',
    });

    const updated = getSession(session.id);
    assert.ok(updated);
    assert.equal(updated!.sdk_session_id, 'sdk-123');
    assert.equal(updated!.sdk_cwd, '/tmp/workspace');
    assert.equal(updated!.runtime_status, 'running');
    assert.equal(updated!.runtime_error, '');
  });

  it('downgrades interrupted running sessions to idle during recovery', () => {
    const session = createSession('Recovery Test', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'running',
      runtimeError: '',
    });

    const recovery = sessionStateManager.recoverSession(session.id);
    const updated = getSession(session.id);

    assert.ok(recovery);
    assert.ok(updated);
    assert.equal(recovery!.runtimeStatus, 'idle');
    assert.equal(updated!.runtime_status, 'idle');
    assert.match(updated!.runtime_error, /interrupted/i);
  });

  it('recovers waiting permission sessions from database records', () => {
    const session = createSession('Permission Recovery', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'waiting_permission',
      runtimeError: '',
    });

    createPermissionRequest({
      id: 'perm-recover',
      sessionId: session.id,
      sdkSessionId: 'sdk-123',
      toolName: 'Read',
      toolInput: JSON.stringify({ file_path: '/tmp/demo.txt' }),
      decisionReason: 'Need approval',
      expiresAt: '2099-01-01 00:00:00',
    });

    const recovery = sessionStateManager.recoverSession(session.id);
    const updated = getSession(session.id);

    assert.ok(recovery);
    assert.ok(updated);
    assert.equal(recovery!.runtimeStatus, 'waiting_permission');
    assert.equal(updated!.runtime_status, 'waiting_permission');
    assert.equal(recovery!.pendingPermission?.toolName, 'Read');
    assert.equal(recovery!.pendingPermission?.toolInput.file_path, '/tmp/demo.txt');
    assert.equal(recovery!.requiresRestart, true);
  });

  it('accepts stopping in runtime state and recovers stranded stopping sessions to idle', () => {
    const session = createSession('Stopping Recovery', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'stopping',
      runtimeError: '',
    });
    upsertSessionRuntimeState(session.id, {
      status: 'stopping',
      pendingPermissions: [],
      generationQueue: [],
    });

    const runtimeState = getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState!.status, 'stopping');

    const recovery = sessionStateManager.recoverSession(session.id);
    const updated = getSession(session.id);
    const recoveredRuntimeState = getSessionRuntimeState(session.id);

    assert.ok(recovery);
    assert.ok(updated);
    assert.ok(recoveredRuntimeState);
    assert.equal(recovery!.runtimeStatus, 'idle');
    assert.equal(updated!.runtime_status, 'idle');
    assert.equal(recoveredRuntimeState!.status, 'idle');
    assert.match(updated!.runtime_error, /stop request/i);
  });

  it('treats stopping sessions as active while the stop is still settling', () => {
    const session = createSession('Active Stopping', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'stopping',
      runtimeError: '',
    });

    const activeSessions = getActiveSessions();
    assert.equal(activeSessions.some((item) => item.id === session.id), true);
  });

  it('recovers dangling streaming assistant content from parts and clears stranded error runtime', () => {
    const session = createSession('Dangling Stream Recovery', 'sonnet', '', tmpDir);
    const assistantMessage = addMessage(session.id, 'assistant', '', null, 'assistant-streaming-1', {
      status: 'streaming',
      contentFormatVersion: 2,
      persistedRevision: 0,
    });

    upsertMessageParts(
      assistantMessage.id,
      session.id,
      [{
        partType: 'text',
        content: 'Recovered from message parts.',
        partKey: 'text:0',
        partIndex: 0,
        revision: 7,
        isFinal: false,
        updatedAt: Date.now(),
      }],
      { pruneMissingPartKeys: true },
    );

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'error',
      runtimeError: 'stream disconnected before response.completed',
    });

    const recovery = sessionStateManager.recoverSession(session.id);
    const updatedSession = getSession(session.id);
    const recoveredMessage = getMessages(session.id, { limit: 10 }).messages.find((msg) => msg.id === assistantMessage.id);
    const recoveredParts = getMessageParts(assistantMessage.id);

    assert.ok(recovery);
    assert.ok(updatedSession);
    assert.ok(recoveredMessage);
    assert.equal(recovery!.runtimeStatus, 'idle');
    assert.equal(updatedSession!.runtime_status, 'idle');
    assert.equal(updatedSession!.runtime_error, '');
    assert.equal(recoveredMessage!.status, 'error');
    assert.match(recoveredMessage!.content, /Recovered from message parts\./);
    assert.equal(recoveredMessage!.persisted_revision, 7);
    assert.equal(recoveredParts.every((part) => part.is_final === 1), true);
  });

  it('preserves real runtime errors when recovery cannot prove stream interruption', () => {
    const session = createSession('Real Error Persistence', 'sonnet', '', tmpDir);

    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'error',
      runtimeError: 'Tool execution failed: exit code 1',
    });

    const recovery = sessionStateManager.recoverSession(session.id);
    const updatedSession = getSession(session.id);

    assert.ok(recovery);
    assert.ok(updatedSession);
    assert.equal(recovery!.runtimeStatus, 'error');
    assert.equal(updatedSession!.runtime_status, 'error');
    assert.equal(updatedSession!.runtime_error, 'Tool execution failed: exit code 1');
  });

  it('cleanup test fixtures', () => {
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
