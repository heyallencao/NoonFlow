'use client';

import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useQuery } from '@tanstack/react-query';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getRuntimeLabel } from '@/lib/runtime-display';

const SUMMARY_ACTIVITY_DAYS = 15;

interface SessionsStats {
  summary: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
  };
  byModel: Array<{ model: string; count: number }>;
  byRuntime: Array<{ runtime: string; count: number }>;
  activityHeatmap: Array<{ date: string; count: number }>;
}

async function fetchSessionsStats(): Promise<SessionsStats> {
  const res = await fetch(`/api/sessions/stats?days=${SUMMARY_ACTIVITY_DAYS}`);
  if (!res.ok) throw new Error('Failed to fetch sessions stats');
  return res.json();
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildFixedActivitySeries(
  activityHeatmap: Array<{ date: string; count: number }> | undefined
): Array<{ name: string; count: number }> {
  const countByDate = new Map(
    (activityHeatmap || []).map((item) => [item.date, item.count])
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const series: Array<{ name: string; count: number }> = [];
  for (let i = SUMMARY_ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - i);
    const key = formatDateKey(current);
    series.push({ name: key.slice(5), count: countByDate.get(key) ?? 0 });
  }
  return series;
}

export function SessionsSummaryCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['sessions-stats-summary', SUMMARY_ACTIVITY_DAYS],
    queryFn: fetchSessionsStats,
  });

  const heatmapData = useMemo(
    () => buildFixedActivitySeries(data?.activityHeatmap),
    [data?.activityHeatmap]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-bg-secondary p-6 shadow-sm">
      <div className="flex items-center justify-between pb-5">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          {t('dashboard.sessionsSummary.title')}
        </h3>
        <Link
          href="/sessions"
          className="text-xs text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
        >
          {t('dashboard.viewMore')} →
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-4 h-28 w-full" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          {/* 统计摘要 */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-sidebar-foreground/52">总会话数</span>
              <span className="font-semibold text-sidebar-foreground">
                {data?.summary?.totalSessions ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sidebar-foreground/52">总成本</span>
              <span className="font-semibold text-sidebar-foreground">
                ${(data?.summary?.totalCost ?? 0).toFixed(2)}
              </span>
            </div>
            {(data?.byRuntime ?? []).slice(0, 2).map((item) => (
              <div key={item.runtime} className="flex justify-between">
                <span className="text-sidebar-foreground/52">
                  {getRuntimeLabel(item.runtime)}
                </span>
                <span className="font-semibold text-sidebar-foreground">{item.count}</span>
              </div>
            ))}
          </div>

          {/* 活动柱状图 */}
          <div className="flex flex-1 flex-col">
            <p className="mb-2 text-xs font-medium text-sidebar-foreground/50">
              {t('dashboard.sessionsSummary.dailyActivity')}
            </p>
            <div className="min-h-[120px] flex-1 rounded-lg bg-bg-primary/60 p-2 lg:min-h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  className={interactiveBarChartClassName}
                  data={heatmapData}
                  margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--sidebar-foreground)', opacity: 0.4 }}
                    interval={4}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.name ?? '')}
                        getValue={(entry) =>
                          t('dashboard.sessionsSummary.sessionCount', {
                            n: Number(entry.count ?? 0),
                          })
                        }
                      />
                    )}
                  />
                  <Bar
                    activeBar
                    dataKey="count"
                    fill="var(--primary)"
                    opacity={0.85}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
