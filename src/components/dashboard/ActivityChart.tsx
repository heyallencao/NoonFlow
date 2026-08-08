'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import { toLocalDateKey } from '@/lib/date-key';
import {
  interactiveBarChartClassName,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';

interface ActivityData {
  activityHeatmap: Array<{ date: string; count: number }>;
}

async function fetchActivity(): Promise<ActivityData> {
  const res = await fetch('/api/sessions/stats?days=15');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export function ActivityChart() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['overview-activity-30d'],
    queryFn: fetchActivity,
  });

  const heatmap = data?.activityHeatmap ?? [];

  // Build last 15 days scaffold
  const today = new Date();
  const chartData = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (14 - i));
    const dateStr = toLocalDateKey(d);
    const found = heatmap.find((h) => h.date === dateStr);
    return { date: dateStr, count: found?.count ?? 0 };
  });

  const avgCount =
    chartData.length > 0
      ? chartData.reduce((s, d) => s + d.count, 0) / chartData.length
      : 0;

  return (
    <div className="flex flex-col rounded-2xl bg-bg-secondary p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-sidebar-foreground">{t('dashboard.activity.title')}</span>
        <button
          type="button"
          onClick={() => router.push('/sessions')}
          aria-label={t('dashboard.activity.title')}
          className="group shrink-0"
        >
          <OverviewActionArrow />
        </button>
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            className={interactiveBarChartClassName}
            data={chartData}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tick={false}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              {...sharedChartTooltipProps}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as { date: string; count: number };
                return (
                  <div className="rounded-lg bg-bg-tertiary px-2 py-1 text-xs text-sidebar-foreground shadow-lg">
                    <div>{d.date}</div>
                    <div className="font-semibold">{t('dashboard.activity.sessionCount', { n: d.count })}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={avgCount}
              stroke="hsl(217,91%,60%)"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />
            <Bar
              activeBar
              dataKey="count"
              fill="hsl(217,91%,60%)"
              radius={[2, 2, 0, 0]}
              maxBarSize={12}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
