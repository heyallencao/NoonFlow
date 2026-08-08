'use client';

import { memo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export interface ContextUsageBarProps {
  /** Total tokens used in this session */
  totalTokens: number;
  /** Used percentage: clamp(round(totalTokens / contextWindowSize * 100), 0, 100) */
  usedPct: number;
  /** Context window size for the current model */
  contextWindowSize: number;
  /** Whether a message is currently streaming */
  isStreaming: boolean;
}

function barColor(pct: number): string {
  if (pct >= 85) return 'bg-red-400';
  if (pct >= 60) return 'bg-yellow-400';
  return 'bg-emerald-400';
}

/**
 * Compact context usage bar — minimal footprint, color-coded fill.
 *
 * Layout:
 *   [████░░░]  23%
 *
 * Color semantics (matches Claude Code CLI style):
 *   0–59%:  green  — normal
 *   60–84%: yellow — warning
 *   85–100%: red   — danger
 */
export const ContextUsageBar = memo(function ContextUsageBar({
  totalTokens,
  usedPct,
  contextWindowSize,
  isStreaming,
}: ContextUsageBarProps) {
  const { t } = useTranslation();
  const displayPct = Math.min(usedPct, 100);
  const fillClass = barColor(usedPct);

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1',
        'border border-border/20',
        'text-xs text-muted-foreground',
        'select-none',
      )}
      title={`${totalTokens.toLocaleString()} / ${contextWindowSize.toLocaleString()} tokens · ${usedPct}%`}
    >
      {/* Compact progress bar — fixed small width, pushed slightly right */}
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted/50 ml-1">
        <div
          className={cn(
            'absolute left-0 top-0 h-full rounded-full transition-all duration-300',
            fillClass,
          )}
          style={{ width: `${displayPct}%` }}
        />
      </div>

      {/* Percentage */}
      <span
        className={cn(
          'tabular-nums font-medium text-[11px]',
          usedPct >= 85 && 'text-red-400',
          usedPct >= 60 && usedPct < 85 && 'text-yellow-500',
          usedPct < 60 && 'text-emerald-500',
        )}
      >
        {usedPct}%
      </span>

      {/* Streaming indicator */}
      {isStreaming && (
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground/50">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-current" />
          {t('contextUsage.live')}
        </span>
      )}
    </div>
  );
});
