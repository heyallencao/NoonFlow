'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { getRuntimeBarClassName, getRuntimeLabel } from '@/lib/runtime-display';
import { MonitorRangePicker, type MonitorRangeDays } from '@/components/insights/MonitorRangePicker';

interface CostsStats {
  periods: {
    todayCost: number;
    weekCost: number;
    monthCost: number;
    totalCost: number;
  };
  costMeta?: {
    mode: 'actual' | 'estimated' | 'mixed' | 'none';
    actualCost: number;
    estimatedCost: number;
    actualRecords: number;
    estimatedRecords: number;
  };
  pricingReference?: {
    unit: 'USD / 1M tokens';
    rules: Array<{
      name: string;
      inputPerMillion: number;
      outputPerMillion: number;
      cacheReadPerMillion: number;
      cacheCreationPerMillion: number;
    }>;
  };
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  byModel: Array<{
    model: string;
    cost: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    cost: number;
    sessions: number;
  }>;
  dailyCosts: Array<{
    date: string;
    cost: number;
  }>;
  weeklyTrend: Array<{
    date: string;
    cost: number;
  }>;
}

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
});

function parseLocalDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
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
  if (!mode || mode === 'actual' || mode === 'none') {
    return formatted;
  }
  return `~${formatted}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString('en-US');
}

async function fetchCostsStats(days: MonitorRangeDays): Promise<CostsStats> {
  const res = await fetch(`/api/usage/stats?days=${days}`);
  if (!res.ok) {
    throw new Error('Failed to fetch costs stats');
  }
  return res.json();
}

export default function CostsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<MonitorRangeDays>(14);
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['costs-stats', range],
    queryFn: () => fetchCostsStats(range),
    placeholderData: (previousData) => previousData,
  });

  const dailyCostsData = useMemo(
    () => (data?.dailyCosts ?? [])
      .slice(-range)
      .map((item) => ({
        name: monthDayFormatter.format(parseLocalDate(item.date)),
        value: item.cost,
      })),
    [data?.dailyCosts, range]
  );

  const weeklyTrendData = useMemo(
    () => (data?.weeklyTrend ?? []).map((item) => ({
      name: weekdayFormatter.format(parseLocalDate(item.date)),
      cost: item.cost,
    })),
    [data?.weeklyTrend]
  );

  const modelCostsData = useMemo(
    () => (data?.byModel ?? []).slice(0, 5),
    [data?.byModel]
  );
  const runtimeCostsData = useMemo(
    () => data?.byRuntime ?? [],
    [data?.byRuntime]
  );
  const costMode = data?.costMeta?.mode;
  const isEstimated = costMode === 'estimated' || costMode === 'mixed';
  const selectedCost = data?.summary.total_cost ?? 0;
  const avgDailyCost = range > 0 ? selectedCost / range : 0;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-red-500">
          {t('costs.error') || '加载成本统计失败'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mb-4 sm:mb-5 lg:mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-sidebar-foreground">
            {t('nav.costs') || '成本分析'}
            {isFetching ? (
              <span className="ml-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle" />
            ) : null}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-sidebar-foreground/60">
            {t('costs.description') || '查看 Token 使用和成本统计'}
          </p>
          {isEstimated ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              成本为估算值（基于 token 用量与模型单价）
            </p>
          ) : null}
        </div>
        <MonitorRangePicker value={range} onChange={setRange} />
      </div>

      <div className="mb-4 sm:mb-5 lg:mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3 lg:gap-3.5">
        <MetricCard
          variant="compact"
          label={`近${range === 1 ? '24h' : `${range}d`}成本`}
          value={formatCostWithMode(selectedCost, costMode)}
          indicatorClassName="bg-blue-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('costs.dailyCost') || '日均成本'}
          value={formatCostWithMode(avgDailyCost, costMode)}
          indicatorClassName="bg-emerald-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label="输入 Tokens"
          value={formatTokenCount(data?.summary.total_input_tokens ?? 0)}
          indicatorClassName="bg-amber-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label="输出 Tokens"
          value={formatTokenCount(data?.summary.total_output_tokens ?? 0)}
          indicatorClassName="bg-rose-400"
          loading={isLoading}
        />
      </div>

      {isEstimated && data?.pricingReference?.rules?.length ? (
        <div className="mb-4 rounded-md border border-amber-300/40 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="font-medium">估算单价标准（{data.pricingReference.unit}）</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {data.pricingReference.rules.map((rule) => (
              <span key={rule.name}>
                {rule.name}: In {rule.inputPerMillion}, Out {rule.outputPerMillion}, CacheRead {rule.cacheReadPerMillion}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold">
              {t('costs.byModel') || '按模型成本分布'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <div className="h-[180px] lg:h-[260px] 2xl:h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  className={interactiveBarChartClassName}
                  data={modelCostsData}
                  layout="vertical"
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="model"
                    tick={{ fontSize: 11, fill: 'var(--chart-tick-strong)' }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.model ?? '')}
                        getValue={(entry) => formatCost(Number(entry.cost ?? 0))}
                      />
                    )}
                  />
                  <Bar
                    activeBar={true}
                    dataKey="cost"
                    fill="var(--chart-blue)"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold">
              {t('costs.byRuntime') || '按运行时成本分布'}
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
            ) : runtimeCostsData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('sessions.noData') || '暂无数据'}
              </p>
            ) : (
              <div className="space-y-3">
                {runtimeCostsData.map((item) => {
                  const maxCost = Math.max(...runtimeCostsData.map((runtime) => runtime.cost), 0.01);
                  const percentage = maxCost > 0 ? (item.cost / maxCost) * 100 : 0;
                  return (
                    <div key={item.runtime} className="flex items-center gap-4">
                      <span className="w-28 shrink-0 text-sm font-medium text-foreground">
                        {getRuntimeLabel(item.runtime)}
                      </span>
                      <div className="flex-1 h-4 overflow-hidden rounded-full bg-sidebar-border/50">
                        <div
                          className={`h-full rounded-full ${getRuntimeBarClassName(item.runtime)}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs text-muted-foreground tabular-nums font-mono">
                        {formatCost(item.cost)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold">
              {t('costs.weeklyTrend') || '本周趋势'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="h-[80px] lg:h-[120px] 2xl:h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyTrendData}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    {...sharedChartTooltipProps}
                    content={(props) => (
                      <MetricChartTooltip
                        {...props}
                        getTitle={(entry) => String(entry.name ?? '')}
                        getValue={(entry) => formatCost(Number(entry.cost ?? 0))}
                      />
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--chart-blue)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-foreground">
              {t('costs.dailyCost') || '每日成本'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="h-[120px] lg:h-[180px] 2xl:h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart className={interactiveBarChartClassName} data={dailyCostsData}>
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
                        getValue={(entry) => formatCost(Number(entry.value ?? 0))}
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
    </div>
  );
}
