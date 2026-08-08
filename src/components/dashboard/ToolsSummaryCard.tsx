'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { useQuery } from '@tanstack/react-query';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ToolsStats {
  summary: {
    totalToolCalls: number;
    errorRate: number;
    distinctTools: number;
  };
  byTool: Array<{
    toolName: string;
    count: number;
    errorRate: number;
  }>;
}

async function fetchToolsStats(): Promise<ToolsStats> {
  const res = await fetch('/api/tools/stats?days=7');
  if (!res.ok) throw new Error('Failed to fetch tools stats');
  return res.json();
}

export function ToolsSummaryCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['tools-stats-summary', 7],
    queryFn: fetchToolsStats,
  });

  const chartData =
    data?.byTool?.slice(0, 5).map((item) => ({
      name: item.toolName,
      count: item.count,
    })) ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-bg-secondary p-6 shadow-sm">
      <div className="flex items-center justify-between pb-5">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          {t('dashboard.toolsSummary.title')}
        </h3>
        <Link
          href="/tools"
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
              <span className="text-sidebar-foreground/52">总调用次数</span>
              <span className="font-semibold text-sidebar-foreground">
                {data?.summary?.totalToolCalls ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sidebar-foreground/52">错误率</span>
              <span className="font-semibold text-sidebar-foreground">
                {((data?.summary?.errorRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* 高频工具横向柱状图 */}
          <div className="flex flex-1 flex-col">
            <p className="mb-2 text-xs font-medium text-sidebar-foreground/50">
              {t('dashboard.toolsSummary.topTools')}
            </p>
            <div className="min-h-[120px] flex-1 rounded-lg bg-bg-primary/60 p-2 lg:min-h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  className={interactiveBarChartClassName}
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={76}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--sidebar-foreground)', opacity: 0.5 }}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.name ?? '')}
                        getValue={(entry) =>
                          t('dashboard.toolsSummary.callCount', {
                            n: Number(entry.count ?? 0),
                          })
                        }
                      />
                    )}
                  />
                  <Bar
                    activeBar
                    dataKey="count"
                    fill="var(--chart-1)"
                    opacity={0.85}
                    radius={[0, 3, 3, 0]}
                    barSize={10}
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
