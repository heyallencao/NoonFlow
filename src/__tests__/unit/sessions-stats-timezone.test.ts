import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const previousTz = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-sessions-stats-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
// Prevent test DB from auto-migrating local user data into temp workspace.
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const { closeDb, createSession, getDb, getSessionsStats } = require('../../lib/db') as typeof import('../../lib/db');

function toDbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (previousTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTz;
  }
});

describe('getSessionsStats timezone handling', () => {
  it('maps UTC stored timestamps to local-hour distribution', () => {
    const session = createSession('TZ Session', 'gpt-5');
    const db = getDb();
    const now = new Date();
    const utcTimestamp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 11, 37));
    const utcText = toDbTimestamp(utcTimestamp);

    db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(utcText, session.id);

    const stats = getSessionsStats(30);
    const hour7Count = stats.hourlyDistribution.find((item) => item.hour === 7)?.count ?? 0;
    const hour15Count = stats.hourlyDistribution.find((item) => item.hour === 15)?.count ?? 0;

    assert.equal(hour7Count, 0);
    assert.equal(hour15Count, 1);

    const recent = stats.recentSessions.find((item) => item.id === session.id);
    assert.ok(recent);
    assert.equal(recent.updatedAt.endsWith('15:11:37'), true);
  });
});
