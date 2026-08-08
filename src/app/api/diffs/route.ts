import { NextRequest, NextResponse } from 'next/server';
import { gitScanner } from '@/lib/git/scanner';
import simpleGit from 'simple-git';
import type { GitRepoStatus } from '@/lib/git/types';

export const dynamic = 'force-dynamic';

interface DiffItem {
  sessionId: string | null;
  workspacePath: string;
  repoRoot: string;
  changedFilesCount: number;
  insertions: number;
  deletions: number;
  updatedAt: string;
  changedFiles?: GitRepoStatus['changedFiles'];
}

/**
 * GET /api/diffs
 * 获取代码变更列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspacePath = searchParams.get('workspace');

    if (!workspacePath) {
      return NextResponse.json(
        { error: 'workspace parameter is required' },
        { status: 400 }
      );
    }

    const result = await gitScanner.scanWorkspace({ workspacePath });
    const diffs: DiffItem[] = [];

    // 获取每个仓库的变更信息
    for (const repo of result.repos) {
      if (repo.dirtyFilesCount > 0 || repo.untrackedFilesCount > 0) {
        diffs.push({
          sessionId: null,
          workspacePath: repo.workspacePath,
          repoRoot: repo.repoRoot,
          changedFilesCount: repo.dirtyFilesCount + repo.untrackedFilesCount,
          insertions: repo.insertions,
          deletions: repo.deletions,
          updatedAt: repo.lastCommitAt || new Date().toISOString(),
          changedFiles: repo.changedFiles,
        });
      }
    }

    // 按更新时间倒序
    diffs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({
      groups: [
        {
          label: 'Recent Changes',
          items: diffs,
        },
      ],
    });
  } catch (error) {
    console.error('Error getting diffs:', error);
    return NextResponse.json(
      { error: 'Failed to get code changes' },
      { status: 500 }
    );
  }
}
