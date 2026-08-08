'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';

interface SessionsStatsResponse {
  byModel: Array<{ model: string; tokens: number; count: number }>;
}

async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  const res = await fetch('/api/sessions/stats?days=365');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

const MODEL_COLORS = [
  'bg-amber-400',
  'bg-blue-400',
  'bg-emerald-400',
  'bg-gray-500',
  'bg-gray-500',
];

function shortenModelName(model: string): string {
  // e.g. "claude-opus-4-6" -> "Opus 4.6", "claude-sonnet-4-5" -> "Sonnet 4.5"
  return model
    .replace(/^claude-/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CostByModelCard() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['overview-sessions-by-model'],
    queryFn: fetchSessionsStats,
  });

  const byModel = (data?.byModel ?? []).slice(0, 5);
  const totalCount = byModel.reduce((s, r) => s + r.count, 0);

  return (
    <div className="flex flex-col rounded-2xl bg-bg-secondary p-4 shadow-sm h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-sidebar-foreground">{t('dashboard.costByModel.title')}</span>
        <button
          type="button"
          onClick={() => router.push('/sessions')}
          aria-label={t('dashboard.costByModel.title')}
          className="group shrink-0"
        >
          <OverviewActionArrow />
        </button>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {byModel.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-sidebar-foreground/40">
            {t('dashboard.costByModel.noData')}
          </div>
        ) : (
          byModel.map((row, i) => {
            const proportion = totalCount > 0 ? (row.count / totalCount) * 100 : 0;
            return (
              <div key={row.model} className="flex items-center gap-2">
                <span
                  className="truncate text-xs text-sidebar-foreground/70 w-28 shrink-0"
                  title={row.model}
                >
                  {shortenModelName(row.model)}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                  <div
                    className={`h-full rounded-full ${MODEL_COLORS[i] ?? 'bg-gray-500'}`}
                    style={{ width: `${proportion}%` }}
                  />
                </div>
                <span className="text-xs text-sidebar-foreground/60 w-14 text-right shrink-0">
                  {proportion >= 1 ? `${Math.round(proportion)}%` : `${proportion.toFixed(1)}%`}
                </span>
              </div>
            );
          })
        )}
      </div>

      {byModel.length > 0 && (
        <div className="mt-3 text-right text-xs font-bold text-sidebar-foreground/70">
          {t('dashboard.costByModel.total')}: {totalCount}
        </div>
      )}
    </div>
  );
}
