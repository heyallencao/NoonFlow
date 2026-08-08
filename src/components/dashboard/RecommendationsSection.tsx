'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { FileText, CircleDollarSign, FolderPlus, GitBranch, FolderGit2 } from 'lucide-react';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';

type RecommendationId =
  | 'large_instruction_file'
  | 'high_monthly_cost'
  | 'missing_project_guide'
  | 'dirty_repo_load'
  | 'stale_branches';

interface OverviewRecommendation {
  id: RecommendationId;
  href: string;
  tone: 'info' | 'warning';
  badgeKind: 'lines' | 'cost' | 'count';
  badgeValue: number;
  primaryAction:
    | { type: 'route'; href: string }
    | { type: 'open_path'; path: string }
    | { type: 'none' };
  details: Record<string, string | number>;
}

interface OverviewRecommendationsResponse {
  recommendations: OverviewRecommendation[];
}

async function fetchRecommendations(workspacePaths: string[]): Promise<OverviewRecommendationsResponse> {
  const res = await fetch('/api/dashboard/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePaths }),
  });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(2)}`;
}

interface Recommendation {
  id: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge: string;
  badgeClassName: string;
  primaryAction:
    | { type: 'route'; href: string }
    | { type: 'open_path'; path: string }
    | { type: 'none' };
}

function resolveOpenPathAction(
  action: OverviewRecommendation['primaryAction'],
): Recommendation['primaryAction'] {
  return action.type === 'open_path' ? action : { type: 'none' };
}

export function RecommendationsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);

  const normalizedWorkspacePaths = useMemo(
    () => Array.from(new Set(workspacePaths.map((workspace) => workspace.trim()).filter(Boolean))),
    [workspacePaths],
  );

  const { data } = useQuery({
    queryKey: ['overview-recommendations', normalizedWorkspacePaths],
    queryFn: () => fetchRecommendations(normalizedWorkspacePaths),
    staleTime: 60_000,
  });

  const recommendations: Recommendation[] = useMemo(
    () => (data?.recommendations ?? []).map((recommendation) => {
      const details = recommendation.details;

      if (recommendation.id === 'large_instruction_file') {
        return {
          id: recommendation.id,
          icon: <FileText className="h-3.5 w-3.5 text-sidebar-foreground/50" />,
          title: t('dashboard.recommendations.largeInstruction', {
            repo: String(details.repoName ?? ''),
            fileName: String(details.fileName ?? ''),
          }),
          desc: t('dashboard.recommendations.largeInstructionDesc', {
            lineCount: Number(details.lineCount ?? 0),
            threshold: Number(details.threshold ?? 0),
          }),
          badge: t('dashboard.recommendations.badge.lines', { n: recommendation.badgeValue }),
          badgeClassName: 'bg-amber-500/20 text-amber-400',
          primaryAction: resolveOpenPathAction(recommendation.primaryAction),
        };
      }

      if (recommendation.id === 'high_monthly_cost') {
        return {
          id: recommendation.id,
          icon: <CircleDollarSign className="h-3.5 w-3.5 text-blue-400" />,
          title: t('dashboard.recommendations.monthlyCost'),
          desc: t('dashboard.recommendations.monthlyCostDesc', {
            cost: formatCost(Number(details.cost ?? 0)),
            threshold: formatCost(Number(details.threshold ?? 0)),
          }),
          badge: t('dashboard.recommendations.badge.cost', {
            cost: formatCost(recommendation.badgeValue),
          }),
          badgeClassName: 'bg-emerald-500/20 text-emerald-400',
          primaryAction: {
            type: 'route',
            href: recommendation.primaryAction.type === 'route' ? recommendation.primaryAction.href : recommendation.href,
          },
        };
      }

      if (recommendation.id === 'dirty_repo_load') {
        return {
          id: recommendation.id,
          icon: <FolderGit2 className="h-3.5 w-3.5 text-orange-400" />,
          title: t('dashboard.recommendations.dirtyRepo', {
            repo: String(details.repoName ?? ''),
          }),
          desc: t('dashboard.recommendations.dirtyRepoDesc', {
            n: Number(details.dirtyFilesCount ?? 0),
            threshold: Number(details.threshold ?? 0),
          }),
          badge: t('dashboard.recommendations.badge.files', { n: recommendation.badgeValue }),
          badgeClassName: 'bg-orange-500/20 text-orange-400',
          primaryAction: {
            type: 'route',
            href: recommendation.primaryAction.type === 'route' ? recommendation.primaryAction.href : recommendation.href,
          },
        };
      }

      if (recommendation.id === 'stale_branches') {
        return {
          id: recommendation.id,
          icon: <GitBranch className="h-3.5 w-3.5 text-violet-400" />,
          title: t('dashboard.recommendations.staleBranches', {
            repo: String(details.repoName ?? ''),
          }),
          desc: t('dashboard.recommendations.staleBranchesDesc', {
            n: Number(details.staleBranchesCount ?? 0),
            threshold: Number(details.threshold ?? 0),
          }),
          badge: t('dashboard.recommendations.badge.branches', { n: recommendation.badgeValue }),
          badgeClassName: 'bg-violet-500/20 text-violet-400',
          primaryAction: {
            type: 'route',
            href: recommendation.primaryAction.type === 'route' ? recommendation.primaryAction.href : recommendation.href,
          },
        };
      }

      return {
        id: recommendation.id,
        icon: <FolderPlus className="h-3.5 w-3.5 text-blue-400/70" />,
        title: t('dashboard.recommendations.missingProjectGuide', {
          n: Number(details.missingCount ?? 0),
        }),
        desc: t('dashboard.recommendations.missingProjectGuideDesc', {
          threshold: Number(details.threshold ?? 0),
        }),
        badge: t('dashboard.recommendations.badge.repos', { n: recommendation.badgeValue }),
        badgeClassName: 'bg-sky-500/20 text-sky-400',
        primaryAction: {
          type: 'route',
          href: recommendation.primaryAction.type === 'route' ? recommendation.primaryAction.href : recommendation.href,
        },
      };
    }),
    [data?.recommendations, t],
  );

  if (recommendations.length === 0) return null;

  async function openPath(targetPath: string) {
    if (typeof window !== 'undefined' && window.electronAPI?.shell?.openPath) {
      await window.electronAPI.shell.openPath(targetPath);
      return;
    }

    const res = await fetch('/api/files/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });

    if (!res.ok) {
      throw new Error('Failed to open path');
    }
  }

  async function runPrimaryAction(rec: Recommendation) {
    try {
      if (rec.primaryAction.type === 'route') {
        router.push(rec.primaryAction.href);
        return;
      }

      if (rec.primaryAction.type === 'open_path') {
        await openPath(rec.primaryAction.path);
      }
    } catch (error) {
      console.error('[overview-recommendations] Failed to run primary action:', error);
      toast.error(t('dashboard.recommendations.openPathFailed'));
    }
  }

  return (
    <div className="rounded-2xl bg-bg-secondary shadow-sm overflow-hidden">
      {recommendations.map((rec, i) => (
        <button
          key={rec.id}
          type="button"
          onClick={() => void runPrimaryAction(rec)}
          className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-tertiary/60 ${
            i < recommendations.length - 1 ? 'border-b border-sidebar-foreground/[0.06]' : ''
          }`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-tertiary shrink-0">
            {rec.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-sidebar-foreground/90 truncate">{rec.title}</p>
            <p className="text-[11px] text-sidebar-foreground/45 truncate mt-0.5">{rec.desc}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${rec.badgeClassName}`}
          >
            {rec.badge}
          </span>
          <OverviewActionArrow />
        </button>
      ))}
    </div>
  );
}
