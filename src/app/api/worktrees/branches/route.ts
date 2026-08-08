import { NextRequest, NextResponse } from 'next/server';
import { gitScanner } from '@/lib/git/scanner';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const repoPath = request.nextUrl.searchParams.get('path');
    if (!repoPath) {
      return NextResponse.json({ error: 'path parameter is required' }, { status: 400 });
    }

    const isGitRepo = await gitScanner.isGitRepository(repoPath);
    if (!isGitRepo) {
      return NextResponse.json(
        {
          error: 'Creating worktrees is only supported for Git repositories',
          code: 'NOT_A_GIT_REPOSITORY',
        },
        { status: 409 }
      );
    }

    const { current, all } = await gitScanner.listBranches(repoPath);
    return NextResponse.json({ current, branches: all });
  } catch (error) {
    console.error('[api/worktrees/branches] Error:', error);
    return NextResponse.json({ error: 'Failed to list branches' }, { status: 500 });
  }
}
