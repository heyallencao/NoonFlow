'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import {
  selectActiveStreamingSessionIds,
  selectPendingPermissionSessionIds,
  useRuntimeStore,
} from '@/stores/runtime-store';

interface SessionsStatsSummaryResponse {
  summary: {
    totalSessions: number;
  };
}

async function fetchTodaySessionsStats(): Promise<SessionsStatsSummaryResponse> {
  const res = await fetch('/api/sessions/stats?days=1');
  if (!res.ok) throw new Error('Failed to fetch sessions stats');
  return res.json();
}

export function OverviewHeader() {
  const { t } = useTranslation();

  const { data: sessionsStats } = useQuery({
    queryKey: ['sessions-stats-summary', 1],
    queryFn: fetchTodaySessionsStats,
  });

  const activeStreamingCount = useRuntimeStore(
    (state) => selectActiveStreamingSessionIds(state).length
  );
  const pendingPermissionCount = useRuntimeStore(
    (state) => selectPendingPermissionSessionIds(state).length
  );

  const { greeting, statusLine } = useMemo(() => {
    const hour = new Date().getHours();
    let greetingText: string;
    if (hour < 12) {
      greetingText = t('dashboard.header.greetingMorning');
    } else if (hour < 18) {
      greetingText = t('dashboard.header.greetingAfternoon');
    } else {
      greetingText = t('dashboard.header.greetingEvening');
    }

    const todaySessions = sessionsStats?.summary.totalSessions ?? 0;
    const pendingTotal = activeStreamingCount + pendingPermissionCount;

    let status: string;
    if (todaySessions === 0) {
      status = t('dashboard.header.statusNoSessions');
    } else {
      status = t('dashboard.header.statusSessions', { n: todaySessions });
      if (pendingTotal > 0) {
        status += t('dashboard.header.statusPending', { n: pendingTotal });
      } else {
        status += t('dashboard.header.statusAllClear');
      }
    }

    return { greeting: greetingText, statusLine: status };
  }, [
    t,
    sessionsStats?.summary.totalSessions,
    activeStreamingCount,
    pendingPermissionCount,
  ]);

  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-sidebar-foreground sm:text-3xl">
          {greeting}
        </h1>
        <p className="mt-1.5 text-sm text-sidebar-foreground/60 sm:text-[15px]">
          {statusLine}
        </p>
      </div>
    </div>
  );
}
