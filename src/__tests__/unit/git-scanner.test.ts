import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { GitScanner } from '../../lib/git/scanner';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('GitScanner.findGitRepos', () => {
  it('treats a .git file as a git repo marker (git worktree root)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monolith-git-scanner-'));
    try {
      const worktreeRoot = path.join(root, 'worktree-root');
      await mkdir(worktreeRoot, { recursive: true });
      await writeFile(path.join(worktreeRoot, '.git'), 'gitdir: /tmp/fake-worktree-gitdir\n', 'utf8');

      const scanner = new GitScanner() as unknown as {
        findGitRepos: (rootPath: string, maxDepth: number) => Promise<string[]>;
      };

      const repos = await scanner.findGitRepos(worktreeRoot, 3);
      assert.deepEqual(repos, [worktreeRoot]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('counts staged created files as uncommitted changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monolith-git-scanner-'));
    const repoDir = path.join(root, 'repo');

    try {
      await mkdir(repoDir, { recursive: true });
      git(repoDir, 'init');
      git(repoDir, 'config', 'user.email', 'monolith@example.com');
      git(repoDir, 'config', 'user.name', 'Monolith Tests');
      await writeFile(path.join(repoDir, 'tracked.txt'), 'base\n', 'utf8');
      git(repoDir, 'add', 'tracked.txt');
      git(repoDir, 'commit', '-m', 'init');

      await writeFile(path.join(repoDir, 'staged.txt'), 'staged\n', 'utf8');
      git(repoDir, 'add', 'staged.txt');

      const scanner = new GitScanner();
      const status = await scanner.scanRepo(repoDir, repoDir);

      assert.equal(status.dirtyFilesCount, 1);
      assert.equal(status.untrackedFilesCount, 0);
      assert.equal(status.status, 'dirty');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refreshes remote tracking before reading behind count', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'monolith-git-scanner-'));
    const remoteDir = path.join(root, 'remote.git');
    const work1Dir = path.join(root, 'work1');
    const work2Dir = path.join(root, 'work2');

    try {
      git(root, 'init', '--bare', remoteDir);
      git(root, 'clone', remoteDir, work1Dir);
      git(work1Dir, 'config', 'user.email', 'monolith@example.com');
      git(work1Dir, 'config', 'user.name', 'Monolith Tests');
      await writeFile(path.join(work1Dir, 'tracked.txt'), 'base\n', 'utf8');
      git(work1Dir, 'add', 'tracked.txt');
      git(work1Dir, 'commit', '-m', 'init');
      git(work1Dir, 'branch', '-M', 'main');
      git(work1Dir, 'push', '-u', 'origin', 'main');

      git(root, 'clone', remoteDir, work2Dir);
      git(work2Dir, 'config', 'user.email', 'monolith@example.com');
      git(work2Dir, 'config', 'user.name', 'Monolith Tests');
      git(work2Dir, 'checkout', 'main');
      await writeFile(path.join(work2Dir, 'tracked.txt'), 'base\nremote\n', 'utf8');
      git(work2Dir, 'commit', '-am', 'remote');
      git(work2Dir, 'push');

      const scanner = new GitScanner();
      const status = await scanner.scanRepo(work1Dir, work1Dir);

      assert.equal(status.aheadCount, 0);
      assert.equal(status.behindCount, 1);
      assert.equal(status.status, 'behind');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
