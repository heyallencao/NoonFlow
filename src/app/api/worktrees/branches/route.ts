import type { NextRequest } from 'next/server';

import { listWorktreeBranches, WorktreeOperationError } from '@/lib/git-worktrees';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspacePath = request.nextUrl.searchParams.get('path')?.trim() || '';
  if (!workspacePath) {
    return Response.json({ error: 'path parameter is required' }, { status: 400 });
  }

  try {
    return Response.json(await listWorktreeBranches(workspacePath));
  } catch (error) {
    if (error instanceof WorktreeOperationError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[api/worktrees/branches]', error);
    return Response.json({ error: 'Failed to list branches' }, { status: 500 });
  }
}
