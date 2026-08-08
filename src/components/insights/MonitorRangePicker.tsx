'use client';

import { cn } from '@/lib/utils';

export type MonitorRangeDays = 1 | 7 | 14 | 30;

export const MONITOR_RANGE_OPTIONS: MonitorRangeDays[] = [1, 7, 14, 30];

function getRangeLabel(days: MonitorRangeDays): string {
  if (days === 1) return '24h';
  return `${days}d`;
}

interface MonitorRangePickerProps {
  value: MonitorRangeDays;
  onChange: (next: MonitorRangeDays) => void;
  className?: string;
}

export function MonitorRangePicker({ value, onChange, className }: MonitorRangePickerProps) {
  return (
    <div className={cn('inline-flex rounded-lg border border-border-subtle bg-bg-tertiary p-1', className)}>
      {MONITOR_RANGE_OPTIONS.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              selected
                ? 'bg-bg-hover text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {getRangeLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
