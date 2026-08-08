'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { MetricCard } from '@/components/ui/metric-card';
import { useTodayCommits } from './useTodayCommits';

interface SessionsStatsResponse {
  summary: {
    totalSessions: number;
  };
}

interface UsageStatsResponse {
  summary: {
    total_cost: number;
  };
  costMeta?: {
    mode: 'actual' | 'estimated' | 'mixed' | 'none';
  };
}

async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  const res = await fetch('/api/sessions/stats?days=30');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

async function fetchUsageStats(): Promise<UsageStatsResponse> {
  const res = await fetch('/api/usage/stats?days=30');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

function formatCost(n: number, mode?: string): string {
  const prefix = mode && mode !== 'actual' && mode !== 'none' ? '~' : '';
  if (n === 0) return `${prefix}$0.00`;
  if (n < 0.01) return `${prefix}$${n.toFixed(4)}`;
  if (n >= 1000) {
    return `${prefix}$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${prefix}$${n.toFixed(2)}`;
}

export function NewOverviewMetrics() {
  const { t } = useTranslation();
  const { commitsToday, repoCount } = useTodayCommits();

  const { data: sessionsStats } = useQuery({
    queryKey: ['overview-sessions-stats-30d'],
    queryFn: fetchSessionsStats,
  });

  const { data: usageStats, isLoading: usageLoading } = useQuery({
    queryKey: ['overview-usage-stats-30d'],
    queryFn: fetchUsageStats,
  });

  const totalSessions = sessionsStats?.summary.totalSessions ?? 0;
  const totalCost = usageStats?.summary.total_cost ?? 0;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.repos')}
        value={repoCount}
        indicatorClassName="bg-blue-400"
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.commitsToday')}
        value={commitsToday}
        indicatorClassName="bg-emerald-400"
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.sessions')}
        value={totalSessions}
        indicatorClassName="bg-green-400"
        className="min-h-[86px] sm:min-h-[92px]"
      />
      <MetricCard
        variant="compact"
        label={t('dashboard.metrics.estCost')}
        value={usageLoading ? '—' : formatCost(totalCost, usageStats?.costMeta?.mode)}
        indicatorClassName="bg-amber-400"
        loading={usageLoading}
        className="min-h-[86px] sm:min-h-[92px]"
      />
    </div>
  );
}
