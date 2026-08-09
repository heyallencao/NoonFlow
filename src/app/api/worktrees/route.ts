import type { NextRequest } from 'next/server';

import {
  createManagedWorktree,
  getWorktreeDeleteStatus,
  listWorktrees,
  MAX_MANAGED_WORKTREES_PER_WORKSPACE,
  removeManagedWorktree,
  WorktreeOperationError,
} from '@/lib/git-worktrees';
import type { CreateWorktreeRequest, DeleteWorktreeRequest, WorktreesResponse } from '@/types';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown): Response {
  if (error instanceof WorktreeOperationError) {
    return Response.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : 'Worktree operation failed';
  console.error('[api/worktrees]', error);
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const workspacePath = request.nextUrl.searchParams.get('workspace')?.trim() || '';
  const worktreePath = request.nextUrl.searchParams.get('worktree')?.trim() || '';
  if (!workspacePath) {
    return Response.json({ error: 'workspace parameter is required' }, { status: 400 });
  }

  try {
    if (worktreePath) {
      const deleteStatus = await getWorktreeDeleteStatus(workspacePath, worktreePath);
      return Response.json({ delete_status: deleteStatus });
    }

    const result = await listWorktrees(workspacePath);
    const response: WorktreesResponse = {
      worktrees: result.worktrees,
      is_git_repo: true,
      workspace_path: result.workspacePath,
      max_managed_worktrees: MAX_MANAGED_WORKTREES_PER_WORKSPACE,
    };
    return Response.json(response);
  } catch (error) {
    if (error instanceof WorktreeOperationError && error.code === 'NOT_A_GIT_REPOSITORY') {
      const response: WorktreesResponse = {
        worktrees: [],
        is_git_repo: false,
        max_managed_worktrees: MAX_MANAGED_WORKTREES_PER_WORKSPACE,
      };
      return Response.json(response);
    }
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<CreateWorktreeRequest>;
    const workspacePath = typeof body.workspace_path === 'string' ? body.workspace_path.trim() : '';
    const branch = typeof body.branch === 'string' ? body.branch.trim() : '';
    const baseBranch = typeof body.base_branch === 'string' ? body.base_branch.trim() : undefined;
    if (!workspacePath || !branch) {
      return Response.json({ error: 'workspace_path and branch are required' }, { status: 400 });
    }

    const worktree = await createManagedWorktree({ workspacePath, branch, baseBranch });
    return Response.json({ worktree }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as Partial<DeleteWorktreeRequest>;
    const workspacePath = typeof body.workspace_path === 'string' ? body.workspace_path.trim() : '';
    const worktreePath = typeof body.worktree_path === 'string' ? body.worktree_path.trim() : '';
    if (!workspacePath || !worktreePath) {
      return Response.json({ error: 'workspace_path and worktree_path are required' }, { status: 400 });
    }
    if (body.confirm !== true) {
      return Response.json(
        { error: 'Deleting a worktree requires explicit confirmation', code: 'CONFIRMATION_REQUIRED' },
        { status: 400 },
      );
    }

    const result = await removeManagedWorktree({
      workspacePath,
      worktreePath,
      forceDirty: body.force_dirty === true,
      deleteBranch: body.delete_branch === true,
    });
    return Response.json({
      success: true,
      deleted_branch: result.deletedBranch,
      branch_delete_error: result.branchDeleteError,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
