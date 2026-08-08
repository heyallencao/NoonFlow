import { NextRequest, NextResponse } from 'next/server';
import { gitScanner } from '@/lib/git/scanner';
import {
  getWorktreesByWorkspace,
  createWorktreeRecord,
  deleteWorktreeRecord,
  getWorktreeById,
  getWorktreeByPath,
  ensureDefaultWorktree,
  WORKTREE_LIMIT_PER_WORKSPACE,
  WORKTREE_LIMIT_GLOBAL,
} from '@/lib/db';
import { getDb } from '@/lib/db-core';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { archiveAndDeleteWorktreeSessions } from '@/lib/workspace-memory';
import { isManagedWorktreeSubPath, normalizeWorkspacePath } from '@/lib/workspace-utils';
import type { Worktree } from '@/types';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const WORKTREE_BASE_DIR = path.join(os.homedir(), '.noonflow', 'worktrees');
const RECONCILE_CACHE_TTL_MS = 3_000;

type ReconciledWorktreeCacheEntry = {
  expiresAt: number;
  worktrees: Worktree[];
};

const reconciledWorktreeCache = new Map<string, ReconciledWorktreeCacheEntry>();
const reconciledWorktreeInFlight = new Map<string, Promise<Worktree[]>>();

function sanitizeWorktreeFolderName(input: string, fallback = 'workspace'): string {
  const cleaned = input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return fallback;
  }

  return cleaned;
}

function buildWorktreeTargetPath(workspacePath: string, branch: string): string {
  const projectName = sanitizeWorktreeFolderName(path.basename(workspacePath), 'workspace');
  const workspaceHash = crypto.createHash('md5').update(workspacePath).digest('hex').slice(0, 8);
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, '_');
  const projectFolderName = `${projectName}_${workspaceHash}`;
  const preferredPath = path.join(WORKTREE_BASE_DIR, projectFolderName, safeBranch);
  const existing = getWorktreeByPath(preferredPath);

  if (!existing || existing.workspace_path === workspacePath) {
    return preferredPath;
  }

  return path.join(WORKTREE_BASE_DIR, `${projectFolderName}_alt`, safeBranch);
}

function filesMatch(leftPath: string, rightPath: string): boolean {
  try {
    return fs.readFileSync(leftPath, 'utf8') === fs.readFileSync(rightPath, 'utf8');
  } catch {
    return false;
  }
}

function cloneNodeModules(sourceNodeModules: string, targetNodeModules: string): void {
  fs.rmSync(targetNodeModules, { recursive: true, force: true });
  fs.cpSync(sourceNodeModules, targetNodeModules, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: true,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

function bootstrapWorktreeNodeModules(workspacePath: string, targetPath: string): void {
  const sourceNodeModules = path.join(workspacePath, 'node_modules');
  const targetNodeModules = path.join(targetPath, 'node_modules');

  if (!fs.existsSync(sourceNodeModules) || fs.existsSync(targetNodeModules)) {
    return;
  }

  const packageLockMatches = filesMatch(
    path.join(workspacePath, 'package-lock.json'),
    path.join(targetPath, 'package-lock.json'),
  );
  const packageJsonMatches = filesMatch(
    path.join(workspacePath, 'package.json'),
    path.join(targetPath, 'package.json'),
  );

  if (!packageLockMatches && !packageJsonMatches) {
    return;
  }

  cloneNodeModules(sourceNodeModules, targetNodeModules);
}

async function ensureWorkspaceDefaultWorktree(workspacePath: string): Promise<void> {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);

  if (isManagedWorktreeSubPath(normalizedWorkspacePath)) {
    return;
  }

  // Always fetch current branch to detect changes (e.g., user switched default branch)
  let branch = '';
  try {
    const { current } = await gitScanner.listBranches(normalizedWorkspacePath);
    branch = current;
  } catch {
    // Not a git repo or error — use empty branch
  }

  // ensureDefaultWorktree will update branch/name if they have changed
  ensureDefaultWorktree(normalizedWorkspacePath, branch);
}

async function reconcileWorkspaceWorktrees(workspacePath: string): Promise<Worktree[]> {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  await ensureWorkspaceDefaultWorktree(normalizedWorkspacePath);

  const isGitRepo = await gitScanner.isGitRepository(normalizedWorkspacePath);
  if (!isGitRepo) {
    return getWorktreesByWorkspace(normalizedWorkspacePath);
  }

  try {
    await gitScanner.pruneWorktrees(normalizedWorkspacePath);
  } catch {
    // Ignore prune failures here and continue with the last known DB state.
  }

  const liveWorktrees = await gitScanner.scanWorktrees(normalizedWorkspacePath);
  if (liveWorktrees.length === 0) {
    return getWorktreesByWorkspace(normalizedWorkspacePath);
  }

  const livePaths = new Set(
    liveWorktrees.map((worktree) => normalizeWorkspacePath(worktree.path))
  );
  livePaths.add(normalizedWorkspacePath);

  const storedWorktrees = getWorktreesByWorkspace(normalizedWorkspacePath);
  for (const worktree of storedWorktrees) {
    if (worktree.is_default) continue;
    if (livePaths.has(normalizeWorkspacePath(worktree.worktree_path))) continue;
    deleteWorktreeRecord(worktree.id);
  }

  return getWorktreesByWorkspace(normalizedWorkspacePath);
}

function invalidateReconciledWorktreeCache(workspacePath?: string): void {
  if (!workspacePath) {
    reconciledWorktreeCache.clear();
    reconciledWorktreeInFlight.clear();
    return;
  }

  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  if (!normalizedWorkspacePath) {
    return;
  }

  reconciledWorktreeCache.delete(normalizedWorkspacePath);
  reconciledWorktreeInFlight.delete(normalizedWorkspacePath);
}

async function getCachedReconciledWorkspaceWorktrees(
  workspacePath: string,
  options?: { force?: boolean },
): Promise<Worktree[]> {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  if (!normalizedWorkspacePath) {
    return [];
  }

  const inFlight = reconciledWorktreeInFlight.get(normalizedWorkspacePath);
  if (!options?.force && inFlight) {
    return inFlight;
  }

  const cached = reconciledWorktreeCache.get(normalizedWorkspacePath);
  if (!options?.force && cached && cached.expiresAt > Date.now()) {
    // Even when the reconcile cache is fresh, eagerly detect branch changes
    // so the default worktree branch stays current without waiting for a full reconcile.
    await ensureWorkspaceDefaultWorktree(normalizedWorkspacePath);
    const refreshed = getWorktreesByWorkspace(normalizedWorkspacePath);
    // Update the cache entry in-place so subsequent reads reflect the new branch
    cached.worktrees = refreshed;
    return refreshed;
  }

  const request = reconcileWorkspaceWorktrees(normalizedWorkspacePath)
    .then((worktrees) => {
      if (reconciledWorktreeInFlight.get(normalizedWorkspacePath) === request) {
        reconciledWorktreeCache.set(normalizedWorkspacePath, {
          expiresAt: Date.now() + RECONCILE_CACHE_TTL_MS,
          worktrees,
        });
      }
      return worktrees;
    })
    .finally(() => {
      if (reconciledWorktreeInFlight.get(normalizedWorkspacePath) === request) {
        reconciledWorktreeInFlight.delete(normalizedWorkspacePath);
      }
    });

  reconciledWorktreeInFlight.set(normalizedWorkspacePath, request);
  return request;
}

async function getReconciledGlobalWorktreeCount(extraWorkspacePath?: string): Promise<number> {
  const db = getDb();
  const workspaceRows = db.prepare(
    'SELECT DISTINCT workspace_path FROM worktrees ORDER BY workspace_path ASC'
  ).all() as Array<{ workspace_path: string }>;

  const workspacePaths = new Set<string>();
  for (const row of workspaceRows) {
    const normalizedWorkspacePath = normalizeWorkspacePath(row.workspace_path || '');
    if (normalizedWorkspacePath && !isManagedWorktreeSubPath(normalizedWorkspacePath)) {
      workspacePaths.add(normalizedWorkspacePath);
    }
  }

  const normalizedExtraWorkspacePath = normalizeWorkspacePath(extraWorkspacePath || '');
  if (normalizedExtraWorkspacePath) {
    workspacePaths.add(normalizedExtraWorkspacePath);
  }

  let total = 0;
  for (const workspacePath of workspacePaths) {
    const worktrees = await reconcileWorkspaceWorktrees(workspacePath);
    total += worktrees.filter((worktree) => !worktree.is_default).length;
  }

  return total;
}

async function getWorktreeDeleteStatus(worktree: Worktree): Promise<{
  checked: boolean;
  hasChanges: boolean;
  dirtyFilesCount: number;
  untrackedFilesCount: number;
}> {
  try {
    const repoStatus = await gitScanner.scanRepo(worktree.worktree_path, worktree.workspace_path);
    if (repoStatus.status === 'error') {
      return {
        checked: false,
        hasChanges: false,
        dirtyFilesCount: 0,
        untrackedFilesCount: 0,
      };
    }

    const dirtyFilesCount = repoStatus.dirtyFilesCount || 0;
    const untrackedFilesCount = repoStatus.untrackedFilesCount || 0;

    return {
      checked: true,
      hasChanges: dirtyFilesCount + untrackedFilesCount > 0,
      dirtyFilesCount,
      untrackedFilesCount,
    };
  } catch {
    return {
      checked: false,
      hasChanges: false,
      dirtyFilesCount: 0,
      untrackedFilesCount: 0,
    };
  }
}

/**
 * GET /api/worktrees
 * Query params:
 * - workspace: workspace path → list managed worktrees from DB
 * - path: repository path → scan git worktrees (legacy)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const workspacePath = searchParams.get('workspace');
    const repoPath = searchParams.get('path');

    if (id) {
      const worktree = getWorktreeById(id);
      if (!worktree) {
        return NextResponse.json(
          { error: 'Worktree not found' },
          { status: 404 }
        );
      }

      const deleteStatus = await getWorktreeDeleteStatus(worktree);
      return NextResponse.json({ worktree, deleteStatus });
    }

    // New: list managed worktrees for a workspace
    if (workspacePath) {
      const worktrees = await getCachedReconciledWorkspaceWorktrees(workspacePath);
      const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
      const isGitRepo = normalizedWorkspacePath
        ? await gitScanner.isGitRepository(normalizedWorkspacePath)
        : false;
      return NextResponse.json({ worktrees, isGitRepo });
    }

    // Legacy: scan git worktrees
    if (repoPath) {
      const worktrees = await gitScanner.scanWorktrees(repoPath);
      return NextResponse.json({
        worktrees,
        summary: {
          total: worktrees.length,
          prunable: worktrees.filter(w => w.isPrunable).length,
        },
      });
    }

    return NextResponse.json(
      { error: 'workspace or path parameter is required' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[api/worktrees] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch worktrees' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/worktrees
 * Create a new worktree for a Git workspace
 * Body: { workspace_path, branch, base_branch?, name? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspace_path, branch, base_branch, name } = body;
    const normalizedWorkspacePath = normalizeWorkspacePath(workspace_path || '');

    if (!normalizedWorkspacePath || !branch) {
      return NextResponse.json(
        { error: 'workspace_path and branch are required' },
        { status: 400 }
      );
    }

    const isGitRepo = await gitScanner.isGitRepository(normalizedWorkspacePath);
    if (!isGitRepo) {
      return NextResponse.json(
        {
          error: 'Creating worktrees is only supported for Git repositories',
          code: 'NOT_A_GIT_REPOSITORY',
        },
        { status: 409 }
      );
    }

    await ensureWorkspaceDefaultWorktree(normalizedWorkspacePath);

    // Check limits
    const workspaceWorktrees = await getCachedReconciledWorkspaceWorktrees(
      normalizedWorkspacePath,
      { force: true },
    );
    const workspaceBillableCount = workspaceWorktrees.filter((worktree) => !worktree.is_default).length;
    if (workspaceBillableCount >= WORKTREE_LIMIT_PER_WORKSPACE) {
      return NextResponse.json(
        { error: `Workspace worktree limit reached (max ${WORKTREE_LIMIT_PER_WORKSPACE})` },
        { status: 409 }
      );
    }

    const globalCount = await getReconciledGlobalWorktreeCount(normalizedWorkspacePath);
    if (globalCount >= WORKTREE_LIMIT_GLOBAL) {
      return NextResponse.json(
        { error: `Global worktree limit reached (max ${WORKTREE_LIMIT_GLOBAL})` },
        { status: 409 }
      );
    }

    // Compute target path: ~/.noonflow/worktrees/<project-name>_<md5>/<branch>/
    const targetPath = buildWorktreeTargetPath(normalizedWorkspacePath, branch);

    // Git operation: create worktree
    await gitScanner.createWorktree(normalizedWorkspacePath, branch, targetPath, base_branch);
    bootstrapWorktreeNodeModules(normalizedWorkspacePath, targetPath);

    // DB record
    const worktree = createWorktreeRecord(
      normalizedWorkspacePath,
      targetPath,
      branch,
      false,
      name || branch,
    );
    invalidateReconciledWorktreeCache(normalizedWorkspacePath);

    return NextResponse.json({ worktree }, { status: 201 });
  } catch (error) {
    console.error('[api/worktrees] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create worktree';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/worktrees?id=<worktree_id>&confirm=true&deleteBranch=true
 * Delete a non-default worktree
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const confirmed = searchParams.get('confirm');
    const deleteBranch = searchParams.get('deleteBranch') === 'true';
    const dirtyConfirmed = searchParams.get('dirtyConfirmed') === 'true';

    if (!id) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    if (confirmed !== 'true') {
      return NextResponse.json(
        {
          error: 'Deleting a worktree requires explicit confirmation',
          code: 'CONFIRMATION_REQUIRED',
        },
        { status: 400 }
      );
    }

    const worktree = getWorktreeById(id);
    if (!worktree) {
      return NextResponse.json(
        { error: 'Worktree not found' },
        { status: 404 }
      );
    }

    if (worktree.is_default) {
      return NextResponse.json(
        { error: 'Cannot delete the default worktree' },
        { status: 403 }
      );
    }

    const deleteStatus = await getWorktreeDeleteStatus(worktree);
    if (deleteStatus.checked && deleteStatus.hasChanges && !dirtyConfirmed) {
      return NextResponse.json(
        {
          error: 'Worktree has uncommitted changes and requires explicit confirmation',
          code: 'DIRTY_WORKTREE_CONFIRMATION_REQUIRED',
          deleteStatus,
        },
        { status: 409 }
      );
    }

    // Git operation: remove worktree (force to handle dirty state)
    try {
      await gitScanner.removeWorktree(worktree.worktree_path, true);
    } catch (gitError) {
      console.warn('[api/worktrees] Git remove failed (may already be removed):', gitError);
    }

    // Optionally delete the branch
    if (deleteBranch && worktree.branch) {
      try {
        await gitScanner.deleteBranch(worktree.workspace_path, worktree.branch);
      } catch (branchError) {
        console.warn('[api/worktrees] Branch delete failed:', branchError);
        // Don't fail the whole operation if branch deletion fails
      }
    }

    // Delete and archive sessions bound to this worktree.
    const { deletedSessionIds } = await archiveAndDeleteWorktreeSessions(id, worktree.worktree_path);

    // DB cleanup
    deleteWorktreeRecord(id);
    invalidateReconciledWorktreeCache(worktree.workspace_path);

    return NextResponse.json({ success: true, deletedSessionIds });
  } catch (error) {
    console.error('[api/worktrees] DELETE error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete worktree';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
