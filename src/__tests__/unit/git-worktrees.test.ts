import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createManagedWorktree,
  getWorktreeDeleteStatus,
  listWorktreeBranches,
  listWorktrees,
  parseWorktreePorcelain,
  removeManagedWorktree,
  WorktreeOperationError,
} from '../../lib/git-worktrees';

const cleanupPaths: string[] = [];
const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function createRepository(): { root: string; repository: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-worktrees-'));
  cleanupPaths.push(root);
  const repository = path.join(root, 'repo with spaces');
  fs.mkdirSync(repository, { recursive: true });
  git(repository, ['init', '-b', 'main']);
  git(repository, ['config', 'user.email', 'noonflow@example.test']);
  git(repository, ['config', 'user.name', 'NoonFlow Test']);
  fs.writeFileSync(path.join(repository, 'README.md'), '# test\n');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'initial']);
  process.env.CLAUDE_GUI_DATA_DIR = path.join(root, 'data');
  return { root, repository };
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.CLAUDE_GUI_DATA_DIR;
  else process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  while (cleanupPaths.length > 0) {
    fs.rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('Git worktree management', () => {
  it('parses NUL-delimited porcelain output without losing paths containing spaces', () => {
    const records = parseWorktreePorcelain([
      'worktree /tmp/repo with spaces',
      'HEAD abcdef1234567890',
      'branch refs/heads/main',
      '',
      'worktree /tmp/feature tree',
      'HEAD 1234567890abcdef',
      'detached',
      'locked reason',
      '',
    ].join('\0'));

    assert.equal(records.length, 2);
    assert.equal(records[0].path, '/tmp/repo with spaces');
    assert.equal(records[0].branch, 'main');
    assert.equal(records[1].path, '/tmp/feature tree');
    assert.equal(records[1].detached, true);
    assert.equal(records[1].locked, true);
  });

  it('lists the local checkout and local branches from a real repository', async () => {
    const { repository } = createRepository();
    const listed = await listWorktrees(repository);
    const branches = await listWorktreeBranches(repository);

    assert.equal(listed.workspacePath, fs.realpathSync(repository));
    assert.equal(listed.worktrees.length, 1);
    assert.equal(listed.worktrees[0].worktree_path, fs.realpathSync(repository));
    assert.equal(listed.worktrees[0].branch, 'main');
    assert.equal(listed.worktrees[0].is_default, true);
    assert.equal(listed.worktrees[0].is_managed, false);
    assert.equal(branches.current, 'main');
    assert.deepEqual(branches.branches, ['main']);
  });

  it('creates a managed worktree from a selected base branch', async () => {
    const { repository } = createRepository();
    const created = await createManagedWorktree({
      workspacePath: repository,
      branch: 'feature/restored-worktree',
      baseBranch: 'main',
    });

    assert.equal(created.branch, 'feature/restored-worktree');
    assert.equal(created.is_default, false);
    assert.equal(created.is_managed, true);
    assert.equal(fs.existsSync(created.worktree_path), true);
    assert.equal(git(created.worktree_path, ['branch', '--show-current']), 'feature/restored-worktree');

    const refreshed = await listWorktrees(repository);
    assert.equal(refreshed.worktrees.some((worktree) => worktree.id === created.id), true);
  });

  it('requires explicit dirty confirmation before removing a managed worktree', async () => {
    const { repository } = createRepository();
    const created = await createManagedWorktree({
      workspacePath: repository,
      branch: 'feature/dirty-worktree',
      baseBranch: 'main',
    });
    fs.writeFileSync(path.join(created.worktree_path, 'uncommitted.txt'), 'keep me\n');

    const status = await getWorktreeDeleteStatus(repository, created.worktree_path);
    assert.equal(status.checked, true);
    assert.equal(status.has_changes, true);
    assert.equal(status.untracked_files_count, 1);

    await assert.rejects(
      removeManagedWorktree({
        workspacePath: repository,
        worktreePath: created.worktree_path,
      }),
      (error: unknown) => (
        error instanceof WorktreeOperationError
        && error.code === 'DIRTY_WORKTREE_CONFIRMATION_REQUIRED'
      ),
    );
    assert.equal(fs.existsSync(created.worktree_path), true);

    await removeManagedWorktree({
      workspacePath: repository,
      worktreePath: created.worktree_path,
      forceDirty: true,
    });
    assert.equal(fs.existsSync(created.worktree_path), false);
    assert.equal(git(repository, ['branch', '--list', 'feature/dirty-worktree']), 'feature/dirty-worktree');
  });

  it('reports branch deletion refusal without misreporting the removed worktree', async () => {
    const { repository } = createRepository();
    const created = await createManagedWorktree({
      workspacePath: repository,
      branch: 'feature/unmerged-worktree',
      baseBranch: 'main',
    });
    fs.writeFileSync(path.join(created.worktree_path, 'feature.txt'), 'unmerged\n');
    git(created.worktree_path, ['add', 'feature.txt']);
    git(created.worktree_path, ['commit', '-m', 'unmerged work']);

    const result = await removeManagedWorktree({
      workspacePath: repository,
      worktreePath: created.worktree_path,
      deleteBranch: true,
    });

    assert.equal(fs.existsSync(created.worktree_path), false);
    assert.equal(result.deletedBranch, false);
    assert.match(result.branchDeleteError || '', /not fully merged|not merged/i);
    assert.equal(git(repository, ['branch', '--list', 'feature/unmerged-worktree']), 'feature/unmerged-worktree');
  });

  it('opens but refuses to delete worktrees that NoonFlow did not create', async () => {
    const { root, repository } = createRepository();
    const externalPath = path.join(root, 'external-worktree');
    git(repository, ['worktree', 'add', '--detach', externalPath, 'main']);

    const listed = await listWorktrees(repository);
    const external = listed.worktrees.find((worktree) => worktree.worktree_path === fs.realpathSync(externalPath));
    assert.ok(external);
    assert.equal(external.is_managed, false);

    await assert.rejects(
      removeManagedWorktree({
        workspacePath: repository,
        worktreePath: externalPath,
        forceDirty: true,
      }),
      (error: unknown) => error instanceof WorktreeOperationError && error.code === 'EXTERNAL_WORKTREE',
    );
    assert.equal(fs.existsSync(externalPath), true);
  });
});
