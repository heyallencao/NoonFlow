import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-stop-route-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/stop/route') as typeof import('../../app/api/chat/stop/route');
const { sessionStateManager } = require('../../lib/session-state-manager') as typeof import('../../lib/session-state-manager');

function toDbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

afterEach(() => {
  db.closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/chat/stop', () => {
  it('keeps a live cross-worker lock until the active worker observes stopping', async () => {
    const session = db.createSession('Cross Worker Stop', 'gpt-5', '', tmpDir);
    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'running',
      runtimeError: '',
    });
    db.upsertSessionRuntimeState(session.id, {
      status: 'running',
      pendingPermissions: [],
      generationQueue: [],
    });

    const acquired = db.acquireSessionLock(session.id, 'stale-lock-1', 'chat-dead-worker', 600);
    assert.equal(acquired, true);

    const beforeCount = (
      db.getDb()
        .prepare('SELECT COUNT(*) AS count FROM session_runtime_locks WHERE session_id = ?')
        .get(session.id) as { count: number }
    ).count;
    assert.equal(beforeCount, 1);

    const response = await route.POST(new Request('http://localhost/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.id }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      stopped: boolean;
      hadActiveRun: boolean;
      requestedCrossWorkerStop: boolean;
      releasedLocks: number;
    };
    assert.equal(payload.stopped, true);
    assert.equal(payload.hadActiveRun, false);
    assert.equal(payload.requestedCrossWorkerStop, true);
    assert.equal(payload.releasedLocks, 0);

    const afterCount = (
      db.getDb()
        .prepare('SELECT COUNT(*) AS count FROM session_runtime_locks WHERE session_id = ?')
        .get(session.id) as { count: number }
    ).count;
    assert.equal(afterCount, 1);

    const runtimeState = db.getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState?.status, 'stopping');
  });

  it('releases a stale running lock instead of waiting for a dead worker', async () => {
    const session = db.createSession('Stop Lock Recovery', 'gpt-5', '', tmpDir);
    sessionStateManager.updateSessionState(session.id, {
      runtimeStatus: 'running',
      runtimeError: '',
    });
    db.upsertSessionRuntimeState(session.id, {
      status: 'running',
      pendingPermissions: [],
      generationQueue: [],
    });

    const acquired = db.acquireSessionLock(session.id, 'stale-lock-2', 'chat-dead-worker', 600);
    assert.equal(acquired, true);

    const now = Date.now();

    db.getDb().prepare(
      `UPDATE session_runtime_locks
       SET updated_at = ?, expires_at = ?
       WHERE session_id = ?`
    ).run(
      toDbTimestamp(new Date(now - 10 * 60_000)),
      toDbTimestamp(new Date(now + 10 * 60_000)),
      session.id,
    );

    const response = await route.POST(new Request('http://localhost/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.id }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      stopped: boolean;
      hadActiveRun: boolean;
      requestedCrossWorkerStop: boolean;
      releasedLocks: number;
    };
    assert.equal(payload.stopped, true);
    assert.equal(payload.hadActiveRun, false);
    assert.equal(payload.requestedCrossWorkerStop, false);
    assert.equal(payload.releasedLocks, 1);

    const afterCount = (
      db.getDb()
        .prepare('SELECT COUNT(*) AS count FROM session_runtime_locks WHERE session_id = ?')
        .get(session.id) as { count: number }
    ).count;
    assert.equal(afterCount, 0);

    const runtimeState = db.getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState?.status, 'idle');
  });
});
