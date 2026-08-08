import { NextRequest, NextResponse } from 'next/server';
import { gitScanner } from '@/lib/git/scanner';

export const dynamic = 'force-dynamic';

/**
 * GET /api/repos
 * 获取仓库列表
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

    return NextResponse.json({
      repos: result.repos,
      scannedAt: result.scannedAt,
      totalRepos: result.totalRepos,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Error scanning repos:', error);
    return NextResponse.json(
      { error: 'Failed to scan repositories' },
      { status: 500 }
    );
  }
}
