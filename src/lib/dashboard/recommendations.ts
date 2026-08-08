import fs from 'node:fs/promises';
import path from 'node:path';
import { gitScanner } from '@/lib/git/scanner';
import { getRuntimeTokenUsageStats } from '@/lib/runtime-stats';
import { createOverviewRecommendationConfig, type OverviewRecommendationConfig } from './recommendation-settings';

const PROJECT_GUIDE_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
const MAX_OVERVIEW_RECOMMENDATIONS = 3;

export type OverviewRecommendationId =
  | 'large_instruction_file'
  | 'high_monthly_cost'
  | 'missing_project_guide'
  | 'dirty_repo_load'
  | 'stale_branches';

export type OverviewRecommendationBadgeKind = 'lines' | 'cost' | 'count';
export type OverviewRecommendationTone = 'info' | 'warning';
export type OverviewRecommendationAction =
  | { type: 'route'; href: string }
  | { type: 'open_path'; path: string }
  | { type: 'none' };

export interface OverviewRecommendation {
  id: OverviewRecommendationId;
  href: string;
  tone: OverviewRecommendationTone;
  badgeKind: OverviewRecommendationBadgeKind;
  badgeValue: number;
  score: number;
  primaryAction: OverviewRecommendationAction;
  details: Record<string, string | number>;
}

export interface RepoGuideInsight {
  repoName: string;
  repoRoot: string;
  dirtyFilesCount: number;
  untrackedFilesCount: number;
  staleBranchesCount: number;
  guideFiles: Array<{
    fileName: string;
    lineCount: number;
    sizeBytes: number;
  }>;
  hasProjectGuide: boolean;
}

export interface OverviewRecommendationSignals {
  monthCost: number;
  repoInsights: RepoGuideInsight[];
}

async function readGuideFile(repoRoot: string, repoName: string, fileName: string) {
  const filePath = path.join(repoRoot, fileName);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
    return {
      repoName,
      repoRoot,
      fileName,
      lineCount,
      sizeBytes,
    };
  } catch {
    return null;
  }
}

async function inspectRepoGuides(repoRoot: string, repoName: string): Promise<RepoGuideInsight> {
  const repoStatus = await gitScanner.scanRepo(repoRoot, repoRoot);
  const guideFiles = (
    await Promise.all(PROJECT_GUIDE_FILES.map((fileName) => readGuideFile(repoRoot, repoName, fileName)))
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    repoName,
    repoRoot,
    dirtyFilesCount: repoStatus.dirtyFilesCount + repoStatus.untrackedFilesCount,
    untrackedFilesCount: repoStatus.untrackedFilesCount,
    staleBranchesCount: repoStatus.staleBranchesCount ?? 0,
    guideFiles,
    hasProjectGuide: guideFiles.length > 0,
  };
}

export async function collectOverviewRecommendationSignals(
  workspacePaths: string[],
): Promise<OverviewRecommendationSignals> {
  const uniqueWorkspaces = Array.from(
    new Set(
      workspacePaths
        .map((workspace) => workspace.trim())
        .filter((workspace) => workspace.length > 0),
    ),
  );

  const workspaceScans = await Promise.all(
    uniqueWorkspaces.map((workspacePath) => gitScanner.scanWorkspace({ workspacePath })),
  );

  const repos = Array.from(
    workspaceScans
      .flatMap((result) => result.repos)
      .reduce((acc, repo) => {
        if (!acc.has(repo.repoRoot)) {
          acc.set(repo.repoRoot, repo);
        }
        return acc;
      }, new Map<string, { repoRoot: string; name: string }>())
      .values(),
  );

  const repoInsights = await Promise.all(
    repos.map((repo) => inspectRepoGuides(repo.repoRoot, repo.name)),
  );

  const usageStats = getRuntimeTokenUsageStats(30);
  const monthCost = usageStats.periods.monthCost ?? usageStats.periods.totalCost ?? 0;

  return {
    monthCost,
    repoInsights,
  };
}

export function buildOverviewRecommendations(
  signals: OverviewRecommendationSignals,
  config: OverviewRecommendationConfig = createOverviewRecommendationConfig('balanced'),
): OverviewRecommendation[] {
  const recommendations: OverviewRecommendation[] = [];

  const largestGuideFile = signals.repoInsights
    .flatMap((repo) => repo.guideFiles.map((guideFile) => ({
      ...guideFile,
      repoName: repo.repoName,
      repoRoot: repo.repoRoot,
    })))
    .sort((left, right) => right.lineCount - left.lineCount)[0];

  if (
    config.rules.largeInstructionFile.enabled
    && largestGuideFile
    && largestGuideFile.lineCount >= config.rules.largeInstructionFile.lineThreshold
  ) {
    const excess = largestGuideFile.lineCount - config.rules.largeInstructionFile.lineThreshold;
    recommendations.push({
      id: 'large_instruction_file',
      href: '/repos',
      tone: 'warning',
      badgeKind: 'lines',
      badgeValue: largestGuideFile.lineCount,
      score: 110 + excess,
      primaryAction: {
        type: 'open_path',
        path: path.join(largestGuideFile.repoRoot, largestGuideFile.fileName),
      },
      details: {
        repoName: largestGuideFile.repoName,
        fileName: largestGuideFile.fileName,
        lineCount: largestGuideFile.lineCount,
        threshold: config.rules.largeInstructionFile.lineThreshold,
      },
    });
  }

  if (config.rules.monthlyCost.enabled && signals.monthCost >= config.rules.monthlyCost.amountThresholdUsd) {
    const excess = signals.monthCost - config.rules.monthlyCost.amountThresholdUsd;
    recommendations.push({
      id: 'high_monthly_cost',
      href: '/costs',
      tone: 'info',
      badgeKind: 'cost',
      badgeValue: signals.monthCost,
      score: 90 + Math.round(excess * 2),
      primaryAction: {
        type: 'route',
        href: '/costs',
      },
      details: {
        cost: signals.monthCost,
        threshold: config.rules.monthlyCost.amountThresholdUsd,
      },
    });
  }

  const missingProjectGuideRepos = signals.repoInsights.filter((repo) => !repo.hasProjectGuide);
  if (
    config.rules.missingProjectGuide.enabled
    && missingProjectGuideRepos.length >= config.rules.missingProjectGuide.minMissingRepos
  ) {
    recommendations.push({
      id: 'missing_project_guide',
      href: '/repos',
      tone: 'info',
      badgeKind: 'count',
      badgeValue: missingProjectGuideRepos.length,
      score: 70 + (missingProjectGuideRepos.length * 10),
      primaryAction: {
        type: 'route',
        href: '/repos',
      },
      details: {
        missingCount: missingProjectGuideRepos.length,
        repoCount: signals.repoInsights.length,
        threshold: config.rules.missingProjectGuide.minMissingRepos,
      },
    });
  }

  const noisiestRepo = [...signals.repoInsights].sort((left, right) => right.dirtyFilesCount - left.dirtyFilesCount)[0];
  if (
    config.rules.dirtyRepo.enabled
    && noisiestRepo
    && noisiestRepo.dirtyFilesCount >= config.rules.dirtyRepo.dirtyFilesThreshold
  ) {
    recommendations.push({
      id: 'dirty_repo_load',
      href: '/hygiene',
      tone: 'warning',
      badgeKind: 'count',
      badgeValue: noisiestRepo.dirtyFilesCount,
      score: 80 + noisiestRepo.dirtyFilesCount,
      primaryAction: {
        type: 'route',
        href: '/hygiene',
      },
      details: {
        repoName: noisiestRepo.repoName,
        dirtyFilesCount: noisiestRepo.dirtyFilesCount,
        threshold: config.rules.dirtyRepo.dirtyFilesThreshold,
      },
    });
  }

  const stalestRepo = [...signals.repoInsights].sort((left, right) => right.staleBranchesCount - left.staleBranchesCount)[0];
  if (
    config.rules.staleBranches.enabled
    && stalestRepo
    && stalestRepo.staleBranchesCount >= config.rules.staleBranches.staleBranchThreshold
  ) {
    recommendations.push({
      id: 'stale_branches',
      href: '/repos',
      tone: 'info',
      badgeKind: 'count',
      badgeValue: stalestRepo.staleBranchesCount,
      score: 60 + (stalestRepo.staleBranchesCount * 8),
      primaryAction: {
        type: 'route',
        href: '/repos',
      },
      details: {
        repoName: stalestRepo.repoName,
        staleBranchesCount: stalestRepo.staleBranchesCount,
        threshold: config.rules.staleBranches.staleBranchThreshold,
      },
    });
  }

  return recommendations
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_OVERVIEW_RECOMMENDATIONS);
}
