import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

type GitDiffRoute = typeof import('../../app/api/git/diff/route');
let route: GitDiffRoute;

before(async () => {
  route = await import('../../app/api/git/diff/route');
});

const tempRepos: string[] = [];

function createTempRepo(): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-git-diff-route-'));
  tempRepos.push(repoDir);

  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'monolith@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Monolith Tests'], { cwd: repoDir });

  fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'tracked\n', 'utf8');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  return repoDir;
}

after(() => {
  for (const repoDir of tempRepos) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

describe('/api/git/diff', () => {
  it('counts untracked file insertions with git numstat semantics', async () => {
    const repoDir = createTempRepo();
    fs.writeFileSync(path.join(repoDir, 'notes.txt'), 'a\n', 'utf8');

    const response = await route.GET(new NextRequest(
      `http://localhost/api/git/diff?cwd=${encodeURIComponent(repoDir)}`,
    ));

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      files: Array<{
        path: string;
        insertions: number;
        deletions: number;
        untracked: boolean;
      }>;
    };

    const untrackedFile = payload.files.find((file) => file.path === 'notes.txt');
    assert.ok(untrackedFile);
    assert.equal(untrackedFile.insertions, 1);
    assert.equal(untrackedFile.deletions, 0);
    assert.equal(untrackedFile.untracked, true);
  });

  it('deduplicates renamed files under the destination path', async () => {
    const repoDir = createTempRepo();
    execFileSync('git', ['mv', 'tracked.txt', 'renamed.txt'], { cwd: repoDir });

    const response = await route.GET(new NextRequest(
      `http://localhost/api/git/diff?cwd=${encodeURIComponent(repoDir)}`,
    ));

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      totals: {
        files: number;
        insertions: number;
        deletions: number;
      };
      files: Array<{
        path: string;
        statusCode: string;
        kind: string;
      }>;
    };

    assert.equal(payload.totals.files, 1);
    assert.deepEqual(payload.files.map((file) => file.path), ['renamed.txt']);
    assert.equal(payload.files[0]?.kind, 'renamed');
    assert.match(payload.files[0]?.statusCode ?? '', /R/);
  });
});
