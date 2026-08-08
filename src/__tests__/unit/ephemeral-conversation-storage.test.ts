import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-ephemeral-conversations-'));
process.env.CLAUDE_GUI_DATA_DIR = dataDir;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../../lib/db') as typeof import('../../lib/db');

describe('ephemeral NoonFlow conversation storage', () => {
  it('keeps the current process usable without writing conversation rows to main', () => {
    const session = db.createSession('Ephemeral session', '', '', dataDir);
    db.addMessage(session.id, 'user', 'hello');

    assert.equal(db.getMessages(session.id).messages.length, 1);
    assert.equal(db.getDb().pragma('temp_store', { simple: true }), 2);
    assert.equal(
      (db.getDb().prepare('SELECT COUNT(*) AS count FROM main.chat_sessions').get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.getDb().prepare('SELECT COUNT(*) AS count FROM main.messages').get() as { count: number }).count,
      0,
    );
  });

  it('discards conversations after close while retaining app settings', () => {
    const session = db.createSession('Discard me', '', '', dataDir);
    db.setSetting('locale', 'zh');
    db.setSetting('telegram_bot_token', 'must-be-removed');
    db.closeDb();

    assert.equal(db.getSession(session.id), undefined);
    assert.equal(db.getSetting('locale'), 'zh');
    assert.equal(db.getSetting('telegram_bot_token'), undefined);
  });
});

after(() => {
  db.closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
