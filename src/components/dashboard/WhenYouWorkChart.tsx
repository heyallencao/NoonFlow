'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  LineChart,
  Line,
  XAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';
import {
  interactiveBarChartClassName,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';

interface SessionsStatsData {
  rollingHourlyDistribution: Array<{ hourStart: string; count: number }>;
}

async function fetchStats(): Promise<SessionsStatsData> {
  const res = await fetch('/api/sessions/stats?days=1');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

const X_AXIS_HOURS = new Set([0, 6, 12, 18]);

function formatHourTick(isoTime: string): string {
  const d = new Date(isoTime);
  const h = d.getHours();
  if (!X_AXIS_HOURS.has(h)) {
    return '';
  }
  return `${String(h).padStart(2, '0')}:00`;
}

export function WhenYouWorkChart() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['overview-hourly-dist'],
    queryFn: fetchStats,
  });

  const rollingHourlyDist = data?.rollingHourlyDistribution ?? [];

  const chartData = rollingHourlyDist.map((entry) => ({
    hourStart: entry.hourStart,
    count: entry.count,
  }));

  return (
    <div className="flex flex-col rounded-2xl bg-bg-secondary p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-sidebar-foreground">{t('dashboard.whenYouWork.title')}</span>
        <button
          type="button"
          onClick={() => router.push('/sessions')}
          aria-label={t('dashboard.whenYouWork.title')}
          className="group shrink-0"
        >
          <OverviewActionArrow />
        </button>
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart
            className={interactiveBarChartClassName}
            data={chartData}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="hourStart"
              tickFormatter={formatHourTick}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              {...sharedChartTooltipProps}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as { hourStart: string; count: number };
                const start = new Date(d.hourStart);
                const end = new Date(start.getTime() + 60 * 60 * 1000);
                const startText = `${String(start.getHours()).padStart(2, '0')}:00`;
                const endText = `${String(end.getHours()).padStart(2, '0')}:00`;
                return (
                  <div className="rounded-lg bg-bg-tertiary px-2 py-1 text-xs text-sidebar-foreground shadow-lg">
                    <div>{startText} - {endText}</div>
                    <div className="font-semibold">{t('dashboard.activity.sessionCount', { n: d.count })}</div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="hsl(217,91%,60%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: 'hsl(217,91%,60%)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
