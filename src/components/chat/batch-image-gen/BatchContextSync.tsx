'use client';

import { useState } from 'react';
import { useBatchImageGen } from '@/hooks/useBatchImageGen';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

export function BatchContextSync() {
  const { state, syncToLlm, resetJob } = useBatchImageGen();
  const { t } = useTranslation();
  const [synced, setSynced] = useState(false);

  if (state.phase !== 'completed' && state.phase !== 'syncing') return null;

  const handleSync = async (syncMode: 'manual' | 'auto_batch' = 'manual') => {
    await syncToLlm(syncMode);
    setSynced(true);
  };

  const isSyncing = state.phase === 'syncing';
  const { progress } = state;

  return (
    <div className="rounded-xl bg-bg-tertiary overflow-hidden">
      <div className="px-4 py-3 bg-purple-500/5">
        <h3 className="text-sm font-medium text-foreground">
          {t('batchImageGen.completed' as TranslationKey)}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t('batchImageGen.completedStats' as TranslationKey)
            .replace('{completed}', String(progress.completed))
            .replace('{total}', String(progress.total))
          }
        </p>
      </div>

      <div className="px-4 py-3 flex items-center gap-2">
        {!synced ? (
          <>
            <button
              type="button"
              onClick={() => handleSync('manual')}
              disabled={isSyncing}
              className="text-xs px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {isSyncing ? '...' : t('batchImageGen.syncToChat' as TranslationKey)}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={resetJob}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t('common.close' as TranslationKey)}
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-green-500">
              {t('batchImageGen.syncComplete' as TranslationKey)}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={resetJob}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t('common.close' as TranslationKey)}
            </button>
          </>
        )}

        {state.error && (
          <p className="text-xs text-red-500">{state.error}</p>
        )}
      </div>
    </div>
  );
}
