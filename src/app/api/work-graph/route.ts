import { NextRequest, NextResponse } from 'next/server';
import simpleGit, { SimpleGit } from 'simple-git';
import { gitScanner } from '@/lib/git/scanner';
import path from 'path';

export const dynamic = 'force-dynamic';

const WORK_GRAPH_CACHE_TTL_MS = 45_000;
const REPO_SCAN_CACHE_TTL_MS = 5 * 60_000;
const MAX_REPO_SCAN_DEPTH = 3;
const REPO_CONCURRENCY = 6;
const MAX_UNCOMMITTED_FILES = 800;
const MAX_FEATURE_BRANCHES = 400;
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

interface WorkGraphPayload {
  commitActivity: CommitActivity[];
  repoCommits: RepoCommits[];
  uncommittedWork: UncommittedFile[];
  uncommittedWorkTotal: number;
  uncommittedWorkTruncated: boolean;
  featureBranches: FeatureBranch[];
  featureBranchesTotal: number;
  featureBranchesTruncated: boolean;
  allRepos: RepoInfo[];
}

const workGraphResponseCache = new Map<string, { expiresAt: number; payload: WorkGraphPayload }>();
const workGraphInFlight = new Map<string, Promise<WorkGraphPayload>>();
const repoScanCache = new Map<string, { expiresAt: number; repos: string[] }>();

interface CommitActivity {
  date: string;
  count: number;
}

interface RepoCommits {
  repoName: string;
  repoPath: string;
  commitCount: number;
}

interface UncommittedFile {
  path: string;
  status: string;
  repoName: string;
}

interface FeatureBranch {
  name: string;
  repoName: string;
  description: string;
  lastCommit?: {
    message: string;
    author: string;
    date: string;
  };
}

interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  status: string;
  lastActivity: string;
}

function toLocalDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * GET /api/work-graph
 * Returns Git work status data
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('workspace');
    const repoPath = searchParams.get('repo');
    const daysRaw = parseInt(searchParams.get('days') || '30', 10);
    const days = Number.isFinite(daysRaw)
      ? Math.max(1, Math.min(365, daysRaw))
      : 30;

    if (!workspacePath) {
      return NextResponse.json(
        { error: 'Workspace path is required' },
        { status: 400 }
      );
    }

    const cacheKey = `${workspacePath}::${days}::${repoPath || ''}`;
    const now = Date.now();
    const cached = workGraphResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload);
    }

    const inFlight = workGraphInFlight.get(cacheKey);
    if (inFlight) {
      const payload = await inFlight;
      return NextResponse.json(payload);
    }

    const buildPromise = buildWorkGraphPayload(workspacePath, days, repoPath);
    workGraphInFlight.set(cacheKey, buildPromise);
    try {
      const payload = await buildPromise;
      workGraphResponseCache.set(cacheKey, { expiresAt: now + WORK_GRAPH_CACHE_TTL_MS, payload });
      return NextResponse.json(payload);
    } finally {
      workGraphInFlight.delete(cacheKey);
    }
  } catch (error) {
    console.error('[work-graph] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch work graph data' },
      { status: 500 }
    );
  }
}

async function buildWorkGraphPayload(workspacePath: string, days: number, repoPath?: string | null): Promise<WorkGraphPayload> {
  const result = await gitScanner.scanWorkspace({ workspacePath });
  const repos = repoPath
    ? result.repos.filter((repo) => repo.repoRoot === repoPath)
    : result.repos;

  if (repos.length === 0) {
    return {
      commitActivity: [],
      repoCommits: [],
      uncommittedWork: [],
      uncommittedWorkTotal: 0,
      uncommittedWorkTruncated: false,
      featureBranches: [],
      featureBranchesTotal: 0,
      featureBranchesTruncated: false,
      allRepos: [],
    };
  }

  const commitActivity: Map<string, number> = new Map();
  const repoCommits: RepoCommits[] = [];
  const uncommittedWork: UncommittedFile[] = [];
  const featureBranches: FeatureBranch[] = [];
  const allRepos: RepoInfo[] = [];
  let uncommittedWorkTotal = 0;
  let featureBranchesTotal = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const since = toLocalDateKey(cutoffDate);

  const snapshots = await mapWithConcurrency(
    repos.map(r => r.repoRoot),
    REPO_CONCURRENCY,
    async (repoPath): Promise<RepoSnapshot | null> => {
      try {
        return await getRepoSnapshot(repoPath, since);
      } catch (error) {
        console.error(`[work-graph] Error processing ${repoPath}:`, error);
        return null;
      }
    }
  );

  for (const snapshot of snapshots) {
    if (!snapshot) continue;

    for (const [date, count] of snapshot.commitActivityByDate.entries()) {
      commitActivity.set(date, (commitActivity.get(date) || 0) + count);
    }

    repoCommits.push(snapshot.repoCommits);

    uncommittedWorkTotal += snapshot.uncommittedWork.length;
    if (uncommittedWork.length < MAX_UNCOMMITTED_FILES) {
      uncommittedWork.push(...snapshot.uncommittedWork.slice(0, MAX_UNCOMMITTED_FILES - uncommittedWork.length));
    }

    featureBranchesTotal += snapshot.featureBranches.length;
    if (featureBranches.length < MAX_FEATURE_BRANCHES) {
      featureBranches.push(...snapshot.featureBranches.slice(0, MAX_FEATURE_BRANCHES - featureBranches.length));
    }

    allRepos.push(snapshot.repoInfo);
  }

  const commitActivityArray: CommitActivity[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = toLocalDateKey(date);
    commitActivityArray.unshift({
      date: dateStr,
      count: commitActivity.get(dateStr) || 0,
    });
  }

  repoCommits.sort((a, b) => b.commitCount - a.commitCount);

  return {
    commitActivity: commitActivityArray,
    repoCommits,
    uncommittedWork,
    uncommittedWorkTotal,
    uncommittedWorkTruncated: uncommittedWorkTotal > uncommittedWork.length,
    featureBranches,
    featureBranchesTotal,
    featureBranchesTruncated: featureBranchesTotal > featureBranches.length,
    allRepos,
  };
}

interface RepoSnapshot {
  commitActivityByDate: Map<string, number>;
  repoCommits: RepoCommits;
  uncommittedWork: UncommittedFile[];
  featureBranches: FeatureBranch[];
  repoInfo: RepoInfo;
}

async function getRepoSnapshot(repoPath: string, since: string): Promise<RepoSnapshot> {
  const git: SimpleGit = simpleGit(repoPath);
  const repoName = path.basename(repoPath);

  const [status, commitDatesRaw, branchMetaRaw] = await Promise.all([
    // Enable untracked files to maintain truth across all insights pages.
    git.status(),
    git.raw(['log', `--since=${since}`, '--date=short', '--pretty=format:%ad']),
    git.raw([
      'for-each-ref',
      '--format=%(refname:short)%09%(subject)%09%(authorname)%09%(committerdate:iso8601)',
      'refs/heads',
    ]),
  ]);

  const commitDates = commitDatesRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const commitActivityByDate = new Map<string, number>();
  for (const date of commitDates) {
    commitActivityByDate.set(date, (commitActivityByDate.get(date) || 0) + 1);
  }

  const currentBranch = status.current || 'unknown';
  const repoCommits: RepoCommits = {
    repoName,
    repoPath,
    commitCount: commitDates.length,
  };

  const modifiedFiles = status.modified.map((filePath) => ({
    path: filePath,
    status: 'modified',
    repoName,
  }));
  const addedFiles = status.created.map((filePath) => ({
    path: filePath,
    status: 'added',
    repoName,
  }));
  const deletedFiles = status.deleted.map((filePath) => ({
    path: filePath,
    status: 'deleted',
    repoName,
  }));
  const renamedFiles = status.renamed.map((filePath) => ({
    path: filePath.to || filePath.from,
    status: 'renamed',
    repoName,
  }));
  const untrackedFiles = status.not_added.map((filePath) => ({
    path: filePath,
    status: 'untracked',
    repoName,
  }));

  const uncommittedWork: UncommittedFile[] = [
    ...modifiedFiles,
    ...addedFiles,
    ...deletedFiles,
    ...renamedFiles,
    ...untrackedFiles,
  ];

  const branchMeta = parseBranchMeta(branchMetaRaw);
  const featureBranches = Array.from(branchMeta.keys())
    .filter(
      (branchName) =>
        branchName !== 'main' &&
        branchName !== 'master' &&
        !branchName.includes('HEAD') &&
        !branchName.startsWith('remotes/')
    )
    .map((branchName) => ({
      name: branchName,
      repoName,
      description: branchName,
      lastCommit: branchMeta.get(branchName),
    }));

  const repoInfo: RepoInfo = {
    name: repoName,
    path: repoPath,
    branch: currentBranch,
    status: status.isClean() ? 'clean' : 'dirty',
    lastActivity: branchMeta.get(currentBranch)?.date || 'Never',
  };

  return {
    commitActivityByDate,
    repoCommits,
    uncommittedWork,
    featureBranches,
    repoInfo,
  };
}

function parseBranchMeta(raw: string): Map<string, FeatureBranch['lastCommit']> {
  const map = new Map<string, FeatureBranch['lastCommit']>();
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const [name, message, author, date] = line.split('\t');
    if (!name) continue;
    if (!message || !author || !date) {
      map.set(name, undefined);
      continue;
    }
    map.set(name, { message, author, date });
  }

  return map;
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
