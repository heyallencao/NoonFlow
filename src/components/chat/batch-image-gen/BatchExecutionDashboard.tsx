'use client';

import { useBatchImageGen } from '@/hooks/useBatchImageGen';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { BatchExecutionItem } from './BatchExecutionItem';

export function BatchExecutionDashboard() {
  const { state, pauseJob, resumeJob, cancelJob, retryFailed } = useBatchImageGen();
  const { t } = useTranslation();

  if (state.phase !== 'executing' && state.phase !== 'completed') return null;

  const { progress, items, currentJob } = state;
  const isPaused = currentJob?.status === 'paused';
  const isRunning = currentJob?.status === 'running';
  const isCompleted = state.phase === 'completed';
  const progressPercent = progress.total > 0
    ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
    : 0;

  const hasFailedItems = items.some(i => i.status === 'failed');

  return (
    <div className="rounded-xl bg-bg-tertiary overflow-hidden">
      {/* Header with progress */}
      <div className="px-4 py-3 border-b border-border/40 bg-purple-500/5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground">
            {t('batchImageGen.totalProgress' as TranslationKey)}
          </h3>
          <span className="text-xs text-muted-foreground">
            {progress.completed}/{progress.total}
            {progress.failed > 0 && (
              <span className="text-red-500 ml-1">({progress.failed} failed)</span>
            )}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPercent}%`,
              background: progress.failed > 0
                ? 'linear-gradient(90deg, rgb(168, 85, 247) 0%, rgb(239, 68, 68) 100%)'
                : 'rgb(168, 85, 247)',
            }}
          />
        </div>
      </div>

      {/* Item list */}
      <div className="p-3 space-y-1.5 max-h-[400px] overflow-y-auto">
        {items.map(item => (
          <BatchExecutionItem key={item.id} item={item} />
        ))}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-border/40 flex items-center gap-2">
        {isRunning && (
          <>
            <button
              type="button"
              onClick={pauseJob}
              className="text-xs px-3 py-1.5 rounded-md border border-border/40 hover:bg-white/[0.04] text-foreground transition-colors"
            >
              {t('batchImageGen.pause' as TranslationKey)}
            </button>
            <button
              type="button"
              onClick={cancelJob}
              className="text-xs px-3 py-1.5 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              {t('batchImageGen.cancel' as TranslationKey)}
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button
              type="button"
              onClick={resumeJob}
              className="text-xs px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors"
            >
              {t('batchImageGen.resume' as TranslationKey)}
            </button>
            <button
              type="button"
              onClick={cancelJob}
              className="text-xs px-3 py-1.5 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              {t('batchImageGen.cancel' as TranslationKey)}
            </button>
          </>
        )}

        {isCompleted && hasFailedItems && (
          <button
            type="button"
            onClick={retryFailed}
            className="text-xs px-3 py-1.5 rounded-md border border-border/40 hover:bg-white/[0.04] text-foreground transition-colors"
          >
            {t('batchImageGen.retryFailed' as TranslationKey)}
          </button>
        )}

        {state.error && (
          <p className="text-xs text-red-500 ml-2">{state.error}</p>
        )}
      </div>
    </div>
  );
}
