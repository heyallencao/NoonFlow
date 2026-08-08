import { NextRequest, NextResponse } from 'next/server';
import { gitScanner } from '@/lib/git/scanner';
import type { GitRepoStatus } from '@/lib/git/types';

export const dynamic = 'force-dynamic';

interface HygieneFinding {
  findingId: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  count?: number;
  linesChanged?: number;
  aheadCount?: number;
  behindCount?: number;
  workspacePath?: string;
  repoRoot?: string;
  actionLabel?: string;
  actionTarget?: string;
}

/**
 * GET /api/hygiene
 * 获取健康检查问题列表
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
    const findings: HygieneFinding[] = [];

    // 分析每个仓库，识别健康问题
    for (const repo of result.repos) {
      const repoFindings = analyzeRepoHealth(repo);
      findings.push(...repoFindings);
    }

    // 统计
    const summary = {
      totalFindings: findings.length,
      critical: findings.filter(f => f.severity === 'critical').length,
      warning: findings.filter(f => f.severity === 'warning').length,
    };

    return NextResponse.json({
      summary,
      findings,
    });
  } catch (error) {
    console.error('Error checking hygiene:', error);
    return NextResponse.json(
      { error: 'Failed to check repository hygiene' },
      { status: 500 }
    );
  }
}

/**
 * 分析单个仓库的健康状况
 */
function analyzeRepoHealth(repo: GitRepoStatus): HygieneFinding[] {
  const findings: HygieneFinding[] = [];

  // 严重：有大量未提交的变更
  if (repo.dirtyFilesCount > 10) {
    findings.push({
      findingId: `${repo.repoRoot}-dirty-critical`,
      type: 'uncommitted-changes',
      severity: 'critical',
      title: 'Large number of uncommitted changes',
      description: `${repo.dirtyFilesCount} files have uncommitted changes. Consider committing or stashing them.`,
      count: repo.dirtyFilesCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Review changes',
      actionTarget: repo.repoRoot,
    });
  } else if (repo.dirtyFilesCount > 0) {
    // 警告：有少量未提交的变更
    findings.push({
      findingId: `${repo.repoRoot}-dirty-warning`,
      type: 'uncommitted-changes',
      severity: 'warning',
      title: 'Uncommitted changes',
      description: `${repo.dirtyFilesCount} files have uncommitted changes.`,
      count: repo.dirtyFilesCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Review changes',
      actionTarget: repo.repoRoot,
    });
  }

  // 警告：有未跟踪的文件
  if (repo.untrackedFilesCount > 0) {
    findings.push({
      findingId: `${repo.repoRoot}-untracked`,
      type: 'untracked-files',
      severity: 'warning',
      title: 'Untracked files',
      description: `${repo.untrackedFilesCount} files are not tracked by Git.`,
      count: repo.untrackedFilesCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Review files',
      actionTarget: repo.repoRoot,
    });
  }

  // 洞察：陈旧分支
  if (repo.staleBranchesCount && repo.staleBranchesCount > 0) {
    findings.push({
      findingId: `${repo.repoRoot}-stale-branches`,
      type: 'stale-branches',
      severity: 'info',
      title: 'Stale branches detected',
      description: `${repo.staleBranchesCount} local branches haven't been updated in over 30 days.`,
      count: repo.staleBranchesCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Clean up',
      actionTarget: repo.repoRoot,
    });
  }

  // 智能洞察：大规模变更风险 (Point 3)
  const totalDiff = repo.insertions + repo.deletions;
  if (totalDiff > 500) {
    findings.push({
      findingId: `${repo.repoRoot}-high-impact`,
      type: 'commit-risk',
      severity: 'warning',
      title: 'Large uncommitted change scope',
      description: `A change of ${totalDiff} lines is becoming difficult to review. Suggest committing in logical chunks.`,
      linesChanged: totalDiff,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Review chunks',
      actionTarget: repo.repoRoot,
    });
  }

  // 智能洞察：关键配置变更
  const hasConfigChanges = repo.changedFiles?.some(f => 
    f.path.includes('package.json') || 
    f.path.includes('tsconfig.json') || 
    f.path.includes('.env')
  );
  if (hasConfigChanges) {
    findings.push({
      findingId: `${repo.repoRoot}-config-check`,
      type: 'config-insight',
      severity: 'info',
      title: 'Configuration changes detected',
      description: 'Critical project configuration files have been modified. Ensure these are intended.',
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Review config',
      actionTarget: repo.repoRoot,
    });
  }

  // 警告：分支分叉
  if (repo.aheadCount > 0 && repo.behindCount > 0) {
    findings.push({
      findingId: `${repo.repoRoot}-diverged`,
      type: 'branch-diverged',
      severity: 'warning',
      title: 'Branch diverged from remote',
      description: `Branch has diverged: ${repo.aheadCount} commits ahead, ${repo.behindCount} commits behind.`,
      aheadCount: repo.aheadCount,
      behindCount: repo.behindCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Resolve divergence',
      actionTarget: repo.repoRoot,
    });
  }

  // 信息：有未推送的提交
  if (repo.aheadCount > 5) {
    findings.push({
      findingId: `${repo.repoRoot}-unpushed`,
      type: 'unpushed-commits',
      severity: 'info',
      title: 'Unpushed commits',
      description: `${repo.aheadCount} commits have not been pushed to remote.`,
      count: repo.aheadCount,
      aheadCount: repo.aheadCount,
      workspacePath: repo.workspacePath,
      repoRoot: repo.repoRoot,
      actionLabel: 'Push commits',
      actionTarget: repo.repoRoot,
    });
  }

  return findings;
}
