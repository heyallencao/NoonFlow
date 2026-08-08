import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import simpleGit from 'simple-git';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isPathSafe, isRootPath } from '@/lib/files';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 300_000;

type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown';

interface ChangeEntry {
  path: string;
  staged: boolean;
  unstaged: boolean;
  insertions: number;
  deletions: number;
  statusCode: string;
  kind: ChangeKind;
  untracked: boolean;
}

function normalizeRelativeFilePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function deduceKind(statusCode: string, untracked: boolean): ChangeKind {
  if (untracked || statusCode.includes('?')) return 'added';
  if (statusCode.includes('R')) return 'renamed';
  if (statusCode.includes('C')) return 'copied';
  if (statusCode.includes('D')) return 'deleted';
  if (statusCode.includes('A')) return 'added';
  if (statusCode.includes('M')) return 'modified';
  return 'unknown';
}

function mergeStatusCode(current: string, incoming: string): string {
  const merged = `${current}${incoming}`.replace(/\s+/g, '');
  if (!merged) return '';
  return Array.from(new Set(merged.split(''))).join('');
}

function trimPatch(patch: string): string {
  if (patch.length <= MAX_PATCH_BYTES) return patch;
  return `${patch.slice(0, MAX_PATCH_BYTES)}\n\n[... 内容已截断]`;
}

function normalizeNumStatPath(filePath: string): string {
  const unquotedPath = unquoteGitPath(filePath);
  const braceRenameMatch = unquotedPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRenameMatch) {
    const [, prefix, , renamedSegment, suffix] = braceRenameMatch;
    return normalizeRelativeFilePath(`${prefix}${renamedSegment}${suffix}`);
  }

  const renameArrowIndex = unquotedPath.lastIndexOf(' => ');
  if (renameArrowIndex >= 0) {
    return normalizeRelativeFilePath(unquotedPath.slice(renameArrowIndex + ' => '.length));
  }

  return normalizeRelativeFilePath(unquotedPath);
}

async function getNumStatDiff(repoRoot: string, args: string[]): Promise<Map<string, { insertions: number; deletions: number }>> {
  try {
    const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', 'diff', '--numstat', ...args], {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
    const result = new Map<string, { insertions: number; deletions: number }>();
    if (!stdout) return result;

    // Parse lines like: "10	5	path/to/file.txt" or "-	-	path/to/binary"
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 3) {
        const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const filePath = normalizeNumStatPath(parts[2]);
        result.set(normalizeRelativeFilePath(filePath), { insertions, deletions });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

async function getNoIndexNumStat(
  repoRoot: string,
  absolutePath: string,
): Promise<{ insertions: number; deletions: number }> {
  try {
    const parseStdout = (stdout: string): { insertions: number; deletions: number } => {
      const line = stdout.trim().split('\n').find(Boolean);
      if (!line) {
        return { insertions: 0, deletions: 0 };
      }

      const [insertionsRaw, deletionsRaw] = line.split('\t');
      return {
        insertions: insertionsRaw === '-' ? 0 : parseInt(insertionsRaw || '0', 10) || 0,
        deletions: deletionsRaw === '-' ? 0 : parseInt(deletionsRaw || '0', 10) || 0,
      };
    };

    const args = [
      '-c',
      'core.quotePath=false',
      'diff',
      '--numstat',
      '--no-index',
      '--',
      '/dev/null',
      absolutePath,
    ];

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: repoRoot,
        maxBuffer: 8 * 1024 * 1024,
      });
      return parseStdout(stdout || '');
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
      const exitCode = typeof failure.code === 'number' ? failure.code : Number(failure.code);
      if (exitCode === 1 && typeof failure.stdout === 'string') {
        return parseStdout(failure.stdout);
      }
      throw error;
    }
  } catch {
    return { insertions: 0, deletions: 0 };
  }
}

async function runGitDiffCommand(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout || '';
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
    const exitCode = typeof failure.code === 'number' ? failure.code : Number(failure.code);
    // `git diff` returns exit code 1 when differences exist for --no-index.
    if (exitCode === 1 && typeof failure.stdout === 'string') {
      return failure.stdout;
    }
    throw error;
  }
}

async function getRepoRoot(cwd: string): Promise<string> {
  const git = simpleGit(cwd, { config: ['core.quotePath=false'] });
  return (await git.revparse(['--show-toplevel'])).trim();
}

function unquoteGitPath(quoted: string): string {
  if (!quoted.includes('\\')) return quoted;
  try {
    return quoted.replace(/\\([0-7]{1,3})/g, (_, octal) => {
      return String.fromCharCode(parseInt(octal, 8));
    });
  } catch {
    return quoted;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const cwdParam = searchParams.get('cwd');
    if (!cwdParam) {
      return NextResponse.json({ error: 'cwd parameter is required' }, { status: 400 });
    }

    const resolvedCwd = path.resolve(cwdParam);
    if (isRootPath(resolvedCwd)) {
      return NextResponse.json({ error: 'cwd cannot be a filesystem root' }, { status: 403 });
    }

    let repoRoot: string;
    try {
      repoRoot = await getRepoRoot(resolvedCwd);
    } catch {
      return NextResponse.json({ error: 'Not a git repository' }, { status: 404 });
    }

    const git = simpleGit(repoRoot, { config: ['core.quotePath=false'] });
    const fileParam = searchParams.get('file');

    if (fileParam) {
      const normalizedTarget = normalizeRelativeFilePath(fileParam);
      const absoluteTarget = path.resolve(repoRoot, normalizedTarget);
      if (!isPathSafe(repoRoot, absoluteTarget)) {
        return NextResponse.json({ error: 'file is outside repository scope' }, { status: 403 });
      }

      const repoRelativePath = normalizeRelativeFilePath(path.relative(repoRoot, absoluteTarget));
      const status = await git.status();
      const isUntracked = status.not_added.includes(repoRelativePath);

      const stagedPatchRaw = await git.diff(['--cached', '--', repoRelativePath]);
      const unstagedPatchRaw = await git.diff(['--', repoRelativePath]);

      let untrackedPatchRaw = '';
      if (!stagedPatchRaw && !unstagedPatchRaw && isUntracked) {
        try {
          await fs.access(absoluteTarget);
          untrackedPatchRaw = await runGitDiffCommand(repoRoot, [
            'diff',
            '--no-index',
            '--',
            '/dev/null',
            absoluteTarget,
          ]);
        } catch {
          // Ignore inaccessible files; UI will show empty diff state.
        }
      }

      return NextResponse.json({
        repoRoot,
        file: repoRelativePath,
        stagedPatch: trimPatch(stagedPatchRaw),
        unstagedPatch: trimPatch(unstagedPatchRaw),
        untrackedPatch: trimPatch(untrackedPatchRaw),
      });
    }

    const [branchSummary, status, stagedNumStat, unstagedNumStat] = await Promise.all([
      git.branchLocal(),
      git.status(),
      getNumStatDiff(repoRoot, ['--cached']),
      getNumStatDiff(repoRoot, []),
    ]);

    const changeMap = new Map<string, ChangeEntry>();

    const upsert = (filePath: string, patch: Partial<ChangeEntry>) => {
      const normalizedPath = normalizeRelativeFilePath(filePath);
      const existing = changeMap.get(normalizedPath) ?? {
        path: normalizedPath,
        staged: false,
        unstaged: false,
        insertions: 0,
        deletions: 0,
        statusCode: '',
        kind: 'unknown' as ChangeKind,
        untracked: false,
      };

      const next: ChangeEntry = {
        ...existing,
        ...patch,
        statusCode: patch.statusCode
          ? mergeStatusCode(existing.statusCode, patch.statusCode)
          : existing.statusCode,
        insertions: existing.insertions + (patch.insertions ?? 0),
        deletions: existing.deletions + (patch.deletions ?? 0),
      };
      next.kind = deduceKind(next.statusCode, next.untracked);
      changeMap.set(normalizedPath, next);
    };

    for (const row of status.files as Array<{ path: string; index?: string; working_dir?: string }>) {
      const indexCode = row.index && row.index !== ' ' ? row.index : '';
      const workCode = row.working_dir && row.working_dir !== ' ' ? row.working_dir : '';
      upsert(row.path, {
        staged: Boolean(indexCode),
        unstaged: Boolean(workCode),
        statusCode: `${indexCode}${workCode}`,
      });
    }

    for (const filePath of status.not_added) {
      upsert(filePath, {
        unstaged: true,
        statusCode: '??',
        untracked: true,
      });
    }

    // Apply numstat data for staged changes
    for (const [filePath, counts] of stagedNumStat) {
      upsert(filePath, {
        staged: true,
        statusCode: 'M',
        insertions: counts.insertions,
        deletions: counts.deletions,
      });
    }

    // Apply numstat data for unstaged changes
    for (const [filePath, counts] of unstagedNumStat) {
      upsert(filePath, {
        unstaged: true,
        statusCode: 'M',
        insertions: counts.insertions,
        deletions: counts.deletions,
      });
    }

    // Handle untracked files: count their lines
    const untrackedPaths = status.not_added.map(normalizeRelativeFilePath);
    const untrackedStats = await Promise.all(
      untrackedPaths.map(async (filePath) => {
        try {
          const absolutePath = path.resolve(repoRoot, filePath);
          const counts = await getNoIndexNumStat(repoRoot, absolutePath);
          return { path: filePath, insertions: counts.insertions, deletions: counts.deletions };
        } catch {
          return { path: filePath, insertions: 0, deletions: 0 };
        }
      })
    );

    for (const stat of untrackedStats) {
      upsert(stat.path, {
        insertions: stat.insertions,
        deletions: stat.deletions,
      });
    }

    const files = Array.from(changeMap.values()).sort((a, b) => a.path.localeCompare(b.path));

    return NextResponse.json({
      repoRoot,
      branch: branchSummary.current || 'HEAD',
      totals: {
        files: files.length,
        insertions: files.reduce((sum, file) => sum + file.insertions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      },
      files,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get git diff';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
