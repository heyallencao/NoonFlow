'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MetricCard } from '@/components/ui/metric-card';
import { useTranslation } from '@/hooks/useTranslation';
import {
  selectActiveStreamingSessionIds,
  selectPendingPermissionSessionIds,
  useRuntimeStore,
} from '@/stores/runtime-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface UsageStatsResponse {
  summary: {
    total_cost: number;
  };
  costMeta?: {
    mode: 'actual' | 'estimated' | 'mixed' | 'none';
  };
}

interface SessionsStatsSummaryResponse {
  summary: {
    totalSessions: number;
  };
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n >= 1000) {
    return `$${n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${n.toFixed(2)}`;
}

function formatCostWithMode(
  n: number,
  mode: 'actual' | 'estimated' | 'mixed' | 'none' | undefined
): string {
  const formatted = formatCost(n);
  if (!mode || mode === 'actual' || mode === 'none') return formatted;
  return `~${formatted}`;
}

async function fetchTodayUsageStats(): Promise<UsageStatsResponse> {
  const res = await fetch('/api/usage/stats?days=1');
  if (!res.ok) throw new Error('Failed to fetch usage stats');
  return res.json();
}

async function fetchTodaySessionsStats(): Promise<SessionsStatsSummaryResponse> {
  const res = await fetch('/api/sessions/stats?days=1');
  if (!res.ok) throw new Error('Failed to fetch sessions stats');
  return res.json();
}

export function OverviewMetrics() {
  const { t } = useTranslation();

  const { data: sessionsStats } = useQuery({
    queryKey: ['sessions-stats-summary', 1],
    queryFn: fetchTodaySessionsStats,
  });
  const { data: usageStats, isLoading: usageLoading } = useQuery({
    queryKey: ['usage-stats-summary', 1],
    queryFn: fetchTodayUsageStats,
  });

  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((state) => state.hiddenWorkspaces);
  const activeStreamingCount = useRuntimeStore(
    (state) => selectActiveStreamingSessionIds(state).length
  );
  const pendingPermissionCount = useRuntimeStore(
    (state) => selectPendingPermissionSessionIds(state).length
  );

  const metrics = useMemo(() => {
    const activeWorkspaces = workspacePaths.filter(
      (path) => !hiddenWorkspaces.includes(path)
    );
    const pendingReminders = pendingPermissionCount + activeStreamingCount;
    return {
      todaySessions: sessionsStats?.summary.totalSessions ?? 0,
      activeWorkspaces: activeWorkspaces.length,
      pendingReminders,
    };
  }, [
    activeStreamingCount,
    hiddenWorkspaces,
    pendingPermissionCount,
    sessionsStats?.summary.totalSessions,
    workspacePaths,
  ]);

  const todayCost = usageStats
    ? formatCostWithMode(usageStats.summary.total_cost, usageStats.costMeta?.mode)
    : '—';

  const hasPending = metrics.pendingReminders > 0;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.todaySessions')}
        value={metrics.todaySessions}
        indicatorClassName="bg-blue-400"
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.activeWorkspaces')}
        value={metrics.activeWorkspaces}
        indicatorClassName="bg-emerald-400"
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.todayCost')}
        value={todayCost}
        indicatorClassName="bg-amber-400"
        loading={usageLoading}
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.pendingReminders')}
        value={metrics.pendingReminders}
        indicatorClassName={hasPending ? 'bg-orange-400 animate-pulse' : 'bg-violet-400'}
        className={
          hasPending
            ? 'min-h-[86px] sm:min-h-[92px] ring-1 ring-orange-400/30 bg-orange-400/5'
            : 'min-h-[86px] sm:min-h-[92px]'
        }
      />
    </div>
  );
}
