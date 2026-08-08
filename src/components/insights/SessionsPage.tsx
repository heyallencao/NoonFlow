'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts';
import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, Message02Icon } from '@hugeicons/core-free-icons';
import { SessionReplayList } from '@/components/sessions/SessionReplayList';
import { getRuntimeBarClassName, getRuntimeLabel } from '@/lib/runtime-display';
import { MonitorRangePicker, type MonitorRangeDays } from '@/components/insights/MonitorRangePicker';

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const hourMinuteFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parseLocalDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

// Format relative time like "2h ago", "6d ago"
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface SessionsStats {
  summary: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
  };
  costMeta?: {
    mode: 'actual' | 'estimated' | 'mixed' | 'none';
  };
  byWorkspace: Array<{
    workspacePath: string;
    count: number;
    messageCount: number;
    lastUpdated: string;
  }>;
  byModel: Array<{
    model: string;
    tokens: number;
    count: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    count: number;
    messageCount: number;
    tokens: number;
    totalCost: number;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    sessionType: string;
    workingDirectory: string;
    updatedAt: string;
    messageCount: number;
    assistantRuntime: string;
  }>;
  activityHeatmap: Array<{
    date: string;
    count: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
  rollingHourlyDistribution: Array<{
    hourStart: string;
    count: number;
  }>;
}

async function fetchSessionsStats(days: number): Promise<SessionsStats> {
  const res = await fetch(`/api/sessions/stats?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch sessions stats');
  return res.json();
}

function formatCostWithMode(
  n: number,
  mode: 'actual' | 'estimated' | 'mixed' | 'none' | undefined
): string {
  const formatted = `$${n.toFixed(2)}`;
  if (!mode || mode === 'actual' || mode === 'none') {
    return formatted;
  }
  return `~${formatted}`;
}

export default function SessionsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<MonitorRangeDays>(14);
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['sessions-stats', range],
    queryFn: () => fetchSessionsStats(range),
    placeholderData: (previousData) => previousData,
  });
  const rollingHourlyDistribution = data?.rollingHourlyDistribution;
  const activityHeatmap = data?.activityHeatmap;
  const runtimeUsage = data?.byRuntime ?? [];
  const costMode = data?.costMeta?.mode;

  // 工作时间分布固定为最近 24 小时（滚动窗口）
  const heatmapData = useMemo(() => {
    return (rollingHourlyDistribution ?? []).map((item) => ({
      hour: hourMinuteFormatter.format(new Date(item.hourStart)),
      value: item.count,
      hourIndex: null as number | null,
    }));
  }, [rollingHourlyDistribution]);

  // 每日活动数据 — 补齐当前筛选窗口，没有记录则为 0
  const dailyActivityData = useMemo(() => {
    if (!activityHeatmap) return [];

    const result = [];
    const today = new Date();
    
    // 创建一个映射以加快查找速度
    const activityMap = new Map(
      activityHeatmap.map(item => [item.date, item.count])
    );

    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      result.push({
        name: monthDayFormatter.format(parseLocalDate(dateString)),
        value: activityMap.get(dateString) || 0,
      });
    }

    return result;
  }, [activityHeatmap, range]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-red-500">
          {t('sessions.error') || '加载会话统计失败'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mb-4 sm:mb-5 lg:mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">
            {t('nav.sessions') || '会话分析'}
            {isFetching ? (
              <span className="ml-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle" />
            ) : null}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
            {t('sessions.description') || '查看会话统计和活跃度分析'}
          </p>
        </div>
        <MonitorRangePicker value={range} onChange={setRange} />
      </div>

      <div className="mb-4 sm:mb-5 lg:mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3 lg:gap-3.5">
        <MetricCard
          variant="compact"
          label={t('sessions.totalSessions') || '总会话数'}
          value={data?.summary.totalSessions || 0}
          indicatorClassName="bg-blue-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('sessions.totalMessages') || '总消息数'}
          value={data?.summary.totalMessages || 0}
          indicatorClassName="bg-emerald-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('sessions.totalTokens') || '总 Token 数'}
          value={`${((data?.summary.totalTokens || 0) / 1000000).toFixed(1)}M`}
          indicatorClassName="bg-amber-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('sessions.totalCost') || '总成本'}
          value={formatCostWithMode(data?.summary.totalCost || 0, costMode)}
          indicatorClassName="bg-cyan-400"
          loading={isLoading}
        />
      </div>

      {/* When You Work */}
      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-foreground">
              {t('sessions.whenYouWork') || '工作时间分布'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="h-[120px] lg:h-[180px] 2xl:h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart className={interactiveBarChartClassName} data={heatmapData}>
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.hour ?? '')}
                        getValue={(entry) => `${entry.value ?? 0} 次活动`}
                      />
                    )}
                  />
                  <Bar activeBar={true} dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {heatmapData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill="var(--chart-blue)"
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Activity */}
      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-foreground">
              {t('sessions.dailyActivity') || '每日活动'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="h-[120px] lg:h-[180px] 2xl:h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart className={interactiveBarChartClassName} data={dailyActivityData}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.name ?? '')}
                        getValue={(entry) => `${entry.value ?? 0} 次活动`}
                      />
                    )}
                  />
                  <Bar
                    activeBar={true}
                    dataKey="value"
                    fill="var(--chart-blue)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model Usage */}
      <div className="mb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              {t('sessions.runtimeUsage') || '运行时使用情况'}
              <span className="text-xs text-muted-foreground font-normal tabular-nums font-mono">
                {runtimeUsage.reduce((sum, item) => sum + item.count, 0) || ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : runtimeUsage.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('sessions.noData') || '暂无数据'}
              </p>
            ) : (
              <div className="space-y-3">
                {runtimeUsage.map((item) => {
                  const maxCount = Math.max(...runtimeUsage.map((runtime) => runtime.count), 1);
                  const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                  return (
                    <div key={item.runtime} className="flex items-center gap-4">
                      <span className="w-32 shrink-0 text-sm font-medium text-foreground">
                        {getRuntimeLabel(item.runtime)}
                      </span>
                      <div className="flex-1 h-4 bg-sidebar-border/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getRuntimeBarClassName(item.runtime)}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs text-muted-foreground tabular-nums font-mono">
                        {item.count} 次
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model Usage */}
      <div className="mb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              {t('sessions.modelUsage') || '模型使用情况'}
              <span className="text-xs text-muted-foreground font-normal tabular-nums font-mono">{data?.byModel.reduce((sum, m) => sum + m.count, 0) || ''}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : data?.byModel.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <svg className="mb-2 h-8 w-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.772.13c-1.687.282-3.41.395-5.135.337L12 20.8l-2.228.08a22.534 22.534 0 0 1-5.135-.337l-.772-.13c-1.717-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
                <p className="text-sm">{t('sessions.noData') || '暂无数据'}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data?.byModel.map((item) => {
                  const maxCount = Math.max(...(data?.byModel.map((m) => m.count) || [1]));
                  const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                  return (
                    <div key={item.model} className="flex items-center gap-4">
                      <span className="w-36 shrink-0 text-sm font-medium text-foreground font-mono truncate">
                        {item.model}
                      </span>
                      <div className="flex-1 h-4 bg-sidebar-border/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs text-muted-foreground tabular-nums font-mono">
                        {item.count} 次
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* By Project */}
      <div className="mb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <HugeiconsIcon icon={Folder01Icon} className="h-4 w-4 text-muted-foreground" />
              {t('sessions.byProject') || '按项目分布'}
              <span className="text-xs text-muted-foreground font-normal tabular-nums">{data?.byWorkspace.length || 0}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-1">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : data?.byWorkspace.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('sessions.noData') || '暂无数据'}
              </p>
            ) : (
              <div className="space-y-1">
                {data?.byWorkspace.slice(0, 10).map((item) => (
                  <div
                    key={item.workspacePath}
                    className="flex items-center justify-between py-2 hover:bg-white/[0.04] rounded-md px-3 -mx-3 cursor-pointer transition-colors"
                  >
                    <span className="flex-1 text-sm font-medium text-blue-500 dark:text-blue-400 font-mono truncate">
                      {item.workspacePath.split('/').pop()}
                    </span>
                    <div className="flex items-center gap-6">
                      <span className="text-sm text-foreground tabular-nums font-mono w-10 text-right font-medium">
                        {item.count}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums font-mono w-16 text-right">
                        {formatRelativeTime(item.lastUpdated)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      <div className="mb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <HugeiconsIcon icon={Message02Icon} className="h-4 w-4 text-muted-foreground" />
              {t('sessions.recentSessions') || 'Recent Sessions'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SessionReplayList limit={8} returnTo="/sessions" />
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
