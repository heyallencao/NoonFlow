import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-worktree-cleanup-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  closeDb,
  createSession,
  createWorktreeRecord,
  getDb,
  getSession,
  getWorktreeCount,
} = require('../../lib/db') as typeof import('../../lib/db');

describe('worktree limit cleanup', () => {
  afterEach(() => {
    closeDb();
  });

  it('removes invalid managed worktree workspace rows before counting global limits', () => {
    const db = getDb();
    const managedPath = '/Users/test/.monolith/worktrees/project_hash/feature-a';

    const validRoot = createWorktreeRecord('/repo/root', '/repo/root', 'main', true, 'default');

    const invalidId = 'invalid-managed-default';
    db.prepare(
      'INSERT INTO worktrees (id, workspace_path, worktree_path, branch, is_default, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, datetime(\'now\'), datetime(\'now\'))'
    ).run(invalidId, managedPath, managedPath, '', 'default');

    const session = createSession('Cleanup target');
    db.prepare(
      'UPDATE chat_sessions SET working_directory = ?, worktree_id = ? WHERE id = ?'
    ).run(managedPath, invalidId, session.id);

    assert.equal(getWorktreeCount(), 0);
    assert.equal(getSession(session.id)?.worktree_id, '');
    assert.equal(getWorktreeCount(validRoot.workspace_path), 0);
  });

  it('counts only non-default worktrees toward the limit', () => {
    createWorktreeRecord('/repo/root', '/repo/root', 'main', true, 'default');
    createWorktreeRecord('/repo/root', '/repo/root/feature-a', 'feature-a', false, 'feature-a');
    createWorktreeRecord('/repo/other', '/repo/other', 'main', true, 'default');
    createWorktreeRecord('/repo/other', '/repo/other/feature-b', 'feature-b', false, 'feature-b');

    assert.equal(getWorktreeCount('/repo/root'), 1);
    assert.equal(getWorktreeCount('/repo/other'), 1);
    assert.equal(getWorktreeCount(), 2);
  });

  it('does not auto-create default worktree rows for managed worktree paths', () => {
    const managedPath = '/Users/test/.monolith/worktrees/project_hash/feature-b';

    const session = createSession('Managed worktree session', '', '', managedPath);

    assert.equal(session.worktree_id, '');
    assert.equal(getWorktreeCount(), 0);
    assert.equal(getSession(session.id)?.worktree_id, '');
  });
});
