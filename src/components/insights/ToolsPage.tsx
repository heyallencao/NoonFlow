'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  FileCode2,
  LoaderCircle,
  Terminal,
  Wrench,
  Workflow,
} from 'lucide-react';

import { MonitorRangePicker, type MonitorRangeDays } from '@/components/insights/MonitorRangePicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { parseTelemetryCreatedAt } from '@/lib/widget-telemetry-time';

interface ToolsStats {
  summary: {
    totalToolCalls: number;
    errorRate: number;
    distinctTools: number;
    errorCount: number;
    totalFilesTouched: number;
    totalSessions: number;
    avgCallsPerSession: number;
    previousPeriodToolCalls: number;
    busiestDay: {
      date: string;
      count: number;
    } | null;
  };
  byTool: Array<{
    toolName: string;
    count: number;
    errorRate: number;
    errorCount: number;
  }>;
  dailyUsage: Array<{
    date: string;
    count: number;
  }>;
  errorProneTools: Array<{
    toolName: string;
    errorCount: number;
    errorRate: number;
  }>;
  recentFailures: Array<{
    sessionId: string;
    toolName: string;
    updatedAt: string;
    error: string;
  }>;
  topCommands: Array<{
    command: string;
    count: number;
  }>;
  topFiles: Array<{
    path: string;
    count: number;
  }>;
  commonSequences: Array<{
    sequence: string;
    count: number;
  }>;
}

const TOOL_COLORS: Record<string, string> = {
  exec_command: 'var(--chart-blue)',
  Bash: 'var(--chart-amber)',
  Read: 'var(--chart-green)',
  write_stdin: '#a78bfa',
  Edit: '#22d3ee',
  Grep: '#f97316',
  Write: '#ec4899',
  Glob: '#14b8a6',
  TodoWrite: '#6366f1',
  view_image: '#8b5cf6',
};

const FALLBACK_PALETTE = [
  'var(--chart-blue)',
  'var(--chart-amber)',
  'var(--chart-green)',
  '#a78bfa',
  '#22d3ee',
  '#f97316',
  '#ec4899',
  '#14b8a6',
];

const RECENT_FAILURES_LIMIT = 5;
const TOP_FILES_LIMIT = 5;

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function getToolColor(toolName: string, index: number): string {
  return TOOL_COLORS[toolName] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function parseLocalDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

async function fetchToolsStats(days: MonitorRangeDays): Promise<ToolsStats> {
  const res = await fetch(`/api/tools/stats?days=${days}`);
  if (!res.ok) {
    throw new Error('Failed to fetch tools stats');
  }

  return res.json();
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatPercent(value: number, digits: number = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function getChangePercent(current: number, previous: number): number {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function formatAvgCalls(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const digits = value >= 100 ? 0 : 1;
  return value.toFixed(digits);
}

function describePath(filePath: string): { name: string; context: string } {
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const name = segments.at(-1) || filePath;
  const context = segments.slice(Math.max(0, segments.length - 4), -1).join('/');
  return { name, context: context || 'project root' };
}

function truncateText(value: string, maxLength: number = 120): string {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatCompactDateTime(value: string): string {
  const parsed = parseTelemetryCreatedAt(value);
  if (!parsed) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function TrendListRow({
  label,
  secondaryLabel,
  badgeLabel,
  value,
  maxValue,
  toneClassName,
}: {
  label: string;
  secondaryLabel?: string;
  badgeLabel?: string;
  value: number;
  maxValue: number;
  toneClassName?: string;
}) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, value > 0 ? 2 : 0) : 0;

  return (
    <div className="group/row flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-tertiary/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">{label}</p>
            {secondaryLabel ? <p className="truncate text-[11px] text-muted-foreground">{secondaryLabel}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {badgeLabel ? (
              <span className="shrink-0 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400 ring-1 ring-rose-500/20">
                {badgeLabel}
              </span>
            ) : null}
            <p className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{formatNumber(value)}</p>
          </div>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sidebar-border/30">
          <div
            className={`h-full rounded-full bg-[var(--chart-blue)] transition-all duration-500 ${toneClassName ?? ''}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<MonitorRangeDays>(14);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['tools-stats', range],
    queryFn: () => fetchToolsStats(range),
    placeholderData: (previousData) => previousData,
  });

  const usageSeries = useMemo(
    () =>
      (data?.dailyUsage ?? []).map((item) => ({
        label: monthDayFormatter.format(parseLocalDate(item.date)),
        date: item.date,
        count: item.count,
      })),
    [data?.dailyUsage]
  );

  const toolSeries = useMemo(
    () =>
      (data?.byTool ?? []).slice(0, 8).map((item) => ({
        toolName: item.toolName,
        count: item.count,
      })),
    [data?.byTool]
  );

  const topCommands = useMemo(() => (data?.topCommands ?? []).slice(0, 8), [data?.topCommands]);
  const topFiles = useMemo(() => (data?.topFiles ?? []).slice(0, TOP_FILES_LIMIT), [data?.topFiles]);
  const sequences = useMemo(() => (data?.commonSequences ?? []).slice(0, 8), [data?.commonSequences]);
  const recentFailures = useMemo(
    () => (data?.recentFailures ?? []).slice(0, RECENT_FAILURES_LIMIT),
    [data?.recentFailures]
  );

  const maxSequenceCount = Math.max(...sequences.map((item) => item.count), 1);
  const maxCommandCount = Math.max(...topCommands.map((item) => item.count), 1);

  const totalChange = data
    ? getChangePercent(data.summary.totalToolCalls, data.summary.previousPeriodToolCalls)
    : 0;

  const formatSignedPercent = (value: number): string => {
    const digits = Math.abs(value) >= 100 ? 0 : 1;
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(digits)}%`;
  };

  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-red-500">{t('tools.error') || '加载工具统计失败'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5 lg:mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t('nav.tools') || '工具分析'}
            {isFetching ? <LoaderCircle className="ml-2 inline-block h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t('tools.description') || '查看工具调用统计和使用分析'}
          </p>
        </div>
        <MonitorRangePicker value={range} onChange={setRange} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:mb-5 sm:grid-cols-2 sm:gap-3 lg:mb-6 lg:gap-3.5 xl:grid-cols-5">
        <MetricCard
          variant="compact"
          label={t('tools.totalCalls') || 'Total Calls'}
          value={formatNumber(data?.summary.totalToolCalls ?? 0)}
          indicatorClassName="bg-blue-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('tools.distinctTools') || 'Tools'}
          value={formatNumber(data?.summary.distinctTools ?? 0)}
          indicatorClassName="bg-emerald-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('tools.avgPerSession') || 'Avg / Session'}
          value={formatAvgCalls(data?.summary.avgCallsPerSession ?? 0)}
          indicatorClassName="bg-amber-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('tools.errorRate') || 'Error Rate'}
          value={formatPercent(data?.summary.errorRate ?? 0)}
          indicatorClassName="bg-rose-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('tools.vsPrevious') || 'vs Previous'}
          value={formatSignedPercent(totalChange)}
          indicatorClassName={totalChange >= 0 ? 'bg-cyan-400' : 'bg-orange-400'}
          loading={isLoading}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 transition-all group-hover/card:bg-blue-500/15 group-hover/card:ring-blue-500/30">
                <Activity className="h-3 w-3" />
              </span>
              {t('tools.recentCalls') || '最近调用'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : usageSeries.length === 0 ? (
              <EmptyState icon={<Activity className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="h-[220px] lg:h-[280px] 2xl:h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart className={interactiveBarChartClassName} data={usageSeries}>
                    <XAxis
                      dataKey="label"
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
                          getTitle={(entry) => String(entry.label ?? '')}
                          getValue={(entry) => `${formatNumber(Number(entry.count ?? 0))} calls`}
                        />
                      )}
                    />
                    <Bar activeBar={true} dataKey="count" radius={[4, 4, 0, 0]}>
                      {usageSeries.map((item) => (
                        <Cell
                          key={item.date}
                          fill={data?.summary.busiestDay?.date === item.date ? 'var(--chart-green)' : 'var(--chart-blue)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 transition-all group-hover/card:bg-emerald-500/15 group-hover/card:ring-emerald-500/30">
                <Wrench className="h-3 w-3" />
              </span>
              {t('tools.byTool') || '按工具分布'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : toolSeries.length === 0 ? (
              <EmptyState icon={<Wrench className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="h-[220px] lg:h-[280px] 2xl:h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart className={interactiveBarChartClassName} data={toolSeries} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="toolName"
                      tick={{ fontSize: 11, fill: 'var(--chart-tick-strong)' }}
                      axisLine={false}
                      tickLine={false}
                      width={120}
                    />
                    <Tooltip
                      {...sharedChartTooltipProps}
                      content={(props) => (
                        <MetricChartTooltip
                          {...props}
                          getTitle={(entry) => String(entry.toolName ?? '')}
                          getValue={(entry) => `${formatNumber(Number(entry.count ?? 0))} ${t('tools.calls') || 'calls'}`}
                        />
                      )}
                    />
                    <Bar activeBar={true} dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26}>
                      {toolSeries.map((item, index) => (
                        <Cell key={item.toolName} fill={getToolColor(item.toolName, index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 transition-all group-hover/card:bg-emerald-500/15 group-hover/card:ring-emerald-500/30">
                <Workflow className="h-3 w-3" />
              </span>
              {t('tools.commonSequences') || '常见序列'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : sequences.length === 0 ? (
              <EmptyState icon={<Workflow className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="space-y-0.5">
                {sequences.map((item) => (
                  <TrendListRow
                    key={item.sequence}
                    label={item.sequence.replaceAll('->', ' → ')}
                    value={item.count}
                    maxValue={maxSequenceCount}
                    toneClassName="bg-emerald-400"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20 transition-all group-hover/card:bg-rose-500/15 group-hover/card:ring-rose-500/30">
                <AlertTriangle className="h-3 w-3" />
              </span>
              {t('tools.recentFailures') || '最近失败'}
            </CardTitle>
          </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : recentFailures.length === 0 ? (
                <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
              ) : (
                <div className="space-y-2">
                  {recentFailures.map((item) => (
                    <div
                      key={`${item.sessionId}-${item.toolName}-${item.updatedAt}`}
                      className="rounded-md border border-border-subtle/70 bg-bg-tertiary/30 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{item.toolName}</p>
                        <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatCompactDateTime(item.updatedAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{truncateText(item.error)}</p>
                    </div>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 transition-all group-hover/card:bg-amber-500/15 group-hover/card:ring-amber-500/30">
                <Terminal className="h-3 w-3" />
              </span>
              {t('tools.topCommands') || '高频命令'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : topCommands.length === 0 ? (
              <EmptyState icon={<Terminal className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="space-y-0.5">
                {topCommands.map((item) => (
                  <TrendListRow
                    key={item.command}
                    label={item.command}
                    value={item.count}
                    maxValue={maxCommandCount}
                    toneClassName="bg-amber-400"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="group/card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20 transition-all group-hover/card:bg-cyan-500/15 group-hover/card:ring-cyan-500/30">
                <FileCode2 className="h-3 w-3" />
              </span>
              {t('tools.topFiles') || '高频文件'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : topFiles.length === 0 ? (
              <EmptyState icon={<FileCode2 className="h-5 w-5" />} title={t('tools.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="space-y-1.5">
                {topFiles.map((item) => {
                  const fileMeta = describePath(item.path);
                  return (
                    <div
                      key={item.path}
                      className="flex items-center justify-between gap-3 rounded-md border border-transparent px-2.5 py-2 transition-colors hover:border-border-subtle hover:bg-bg-tertiary/40"
                      title={item.path}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{fileMeta.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{fileMeta.context}</p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(item.count)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
