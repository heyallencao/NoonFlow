'use client';

import type { ReactNode } from 'react';
import type { TooltipPayloadEntry } from 'recharts';

import { cn } from '@/lib/utils';

export const interactiveBarChartClassName = 'interactive-bar-chart';

export const sharedChartTooltipProps = {
  allowEscapeViewBox: { x: true, y: true },
  contentStyle: {
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 0,
    boxShadow: 'none',
    padding: 0,
  },
  cursor: false,
  itemStyle: { color: '#ffffff' },
  labelStyle: { color: 'var(--chart-tick-strong)' },
  wrapperStyle: { outline: 'none' },
} as const;

interface ChartTooltipSurfaceProps {
  children: ReactNode;
  className?: string;
}

export function ChartTooltipSurface({ children, className }: ChartTooltipSurfaceProps) {
  return (
    <div
      className={cn(
        'min-w-[120px] rounded-lg border border-border-default bg-bg-primary px-3 py-2 text-xs leading-relaxed text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

type ChartTooltipDatum = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartTooltipEntry = TooltipPayloadEntry<any, any>;

interface MetricChartTooltipProps {
  active?: boolean;
  payload?: readonly ChartTooltipEntry[];
  getTitle: (entry: ChartTooltipDatum, tooltipEntry: ChartTooltipEntry) => ReactNode;
  getValue: (entry: ChartTooltipDatum, tooltipEntry: ChartTooltipEntry) => ReactNode;
  className?: string;
  [key: string]: unknown;
}

export function MetricChartTooltip({
  active,
  payload,
  getTitle,
  getValue,
  className,
}: MetricChartTooltipProps) {
  const tooltipEntry = payload?.[0] as ChartTooltipEntry | undefined;
  const entry = tooltipEntry?.payload as ChartTooltipDatum | undefined;

  if (!active || !tooltipEntry || !entry) {
    return null;
  }

  return (
    <ChartTooltipSurface className={className}>
      <p className="text-[11px] text-white/72">{getTitle(entry, tooltipEntry)}</p>
      <p className="mt-1 font-medium text-white">{getValue(entry, tooltipEntry)}</p>
    </ChartTooltipSurface>
  );
}
