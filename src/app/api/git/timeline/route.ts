import { NextRequest, NextResponse } from 'next/server';
import simpleGit, { SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const TIMELINE_CACHE_TTL_MS = 45_000;
const REPO_SCAN_CACHE_TTL_MS = 5 * 60_000;
const MAX_REPO_SCAN_DEPTH = 3;
const REPO_CONCURRENCY = 6;
const SCAN_SKIP_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
]);

interface TimelinePayload {
  repos: number;
  branches: number;
  commits: number;
  timelines: RepoTimeline[];
}

const timelineResponseCache = new Map<string, { expiresAt: number; payload: TimelinePayload }>();
const timelineInFlight = new Map<string, Promise<TimelinePayload>>();
const repoScanCache = new Map<string, { expiresAt: number; repos: string[] }>();

interface BranchInfo {
  name: string;
  current: boolean;
  commitCount: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}

interface RepoTimeline {
  workspacePath: string;
  repoPath: string;
  repoName: string;
  branches: BranchInfo[];
  commits: Array<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    branch: string;
  }>;
}

/**
 * GET /api/git/timeline
 * Returns git timeline for all repos in one or more workspaces
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePaths = Array.from(new Set(
      searchParams
        .getAll('workspace')
        .map((value) => normalizeWorkspacePath(value))
        .filter(Boolean)
    ));
    const maxCommitsRaw = parseInt(searchParams.get('maxCommits') || '50', 10);
    const maxCommits = Number.isFinite(maxCommitsRaw)
      ? Math.max(10, Math.min(200, maxCommitsRaw))
      : 50;

    if (workspacePaths.length === 0) {
      return NextResponse.json(
        { error: 'At least one workspace path is required' },
        { status: 400 }
      );
    }

    const cacheKey = `${workspacePaths.join('||')}::${maxCommits}`;
    const now = Date.now();
    const cached = timelineResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload);
    }

    const inFlight = timelineInFlight.get(cacheKey);
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json(payload);
    }

    const buildPromise = buildTimelinePayload(workspacePaths, maxCommits);
    timelineInFlight.set(cacheKey, buildPromise);
    try {
      const payload = await buildPromise;
      timelineResponseCache.set(cacheKey, { expiresAt: now + TIMELINE_CACHE_TTL_MS, payload });
      return NextResponse.json(payload);
    } finally {
      timelineInFlight.delete(cacheKey);
    }
  } catch (error) {
    console.error('[git/timeline] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch git timeline' },
      { status: 500 }
    );
  }
}

async function buildTimelinePayload(workspacePaths: string[], maxCommits: number): Promise<TimelinePayload> {
  const repoEntries = await mapWithConcurrency(
    workspacePaths,
    Math.min(REPO_CONCURRENCY, workspacePaths.length),
    async (workspacePath) => {
      const repos = await scanGitRepos(workspacePath);
      return repos.map((repoPath) => ({ workspacePath, repoPath }));
    }
  );

  const uniqueRepos = new Map<string, string>();
  for (const entries of repoEntries) {
    for (const entry of entries) {
      if (!uniqueRepos.has(entry.repoPath)) {
        uniqueRepos.set(entry.repoPath, entry.workspacePath);
      }
    }
  }

  const timelineCandidates = await mapWithConcurrency(
    Array.from(uniqueRepos.entries()),
    REPO_CONCURRENCY,
    async ([repoPath, workspacePath]): Promise<RepoTimeline | null> => {
      try {
        return await getRepoTimeline(repoPath, workspacePath, maxCommits);
      } catch (error) {
        console.error(`[git/timeline] Error scanning ${repoPath}:`, error);
        return null;
      }
    }
  );

  const timelines = timelineCandidates.filter((repo): repo is RepoTimeline => repo !== null);
  return {
    repos: timelines.length,
    branches: timelines.reduce((sum, t) => sum + t.branches.length, 0),
    commits: timelines.reduce((sum, t) => sum + t.commits.length, 0),
    timelines,
  };
}

function normalizeWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function scanGitRepos(rootPath: string, maxDepth = MAX_REPO_SCAN_DEPTH): Promise<string[]> {
  const now = Date.now();
  const cached = repoScanCache.get(rootPath);
  if (cached && cached.expiresAt > now) {
    return cached.repos;
  }

  const repos: string[] = [];

  const scan = async (currentPath: string, depth: number) => {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      const hasGitDir = entries.some(entry => entry.isDirectory() && entry.name === '.git');
      if (hasGitDir) {
        repos.push(currentPath);
        return;
      }

      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !SCAN_SKIP_DIRS.has(entry.name)
        ) {
          await scan(path.join(currentPath, entry.name), depth + 1);
        }
      }
    } catch {
      // Ignore inaccessible directories
    }
  };

  await scan(rootPath, 0);
  repoScanCache.set(rootPath, { expiresAt: now + REPO_SCAN_CACHE_TTL_MS, repos });
  return repos;
}

async function getRepoTimeline(
  repoPath: string,
  workspacePath: string,
  maxCommits: number
): Promise<RepoTimeline> {
  const git: SimpleGit = simpleGit(repoPath);
  const repoName = path.basename(repoPath);

  const [branchSummary, log] = await Promise.all([
    git.branchLocal(),
    git.log({ maxCount: maxCommits }),
  ]);

  const branches: BranchInfo[] = branchSummary.all.map((branchName) => ({
    name: branchName,
    current: branchName === branchSummary.current,
    // Avoid per-branch expensive git calls on initial timeline render.
    commitCount: 0,
  }));

  // Get recent commits
  const commits = log.all.map(commit => ({
    hash: commit.hash,
    shortHash: commit.hash.substring(0, 7),
    message: commit.message.length > 180 ? `${commit.message.slice(0, 177)}...` : commit.message,
    author: commit.author_name,
    date: commit.date,
    branch: branchSummary.current,
  }));

  return {
    workspacePath,
    repoPath,
    repoName,
    branches,
    commits,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}
