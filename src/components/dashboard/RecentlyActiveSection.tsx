'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';

interface WorkspaceEntry {
  workspacePath: string;
  count: number;
  lastUpdated: string;
}

interface SessionsStatsResponse {
  byWorkspace: WorkspaceEntry[];
}

async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  const res = await fetch('/api/sessions/stats?days=30');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

const PILL_COLORS = [
  'bg-blue-400',
  'bg-green-400',
  'bg-orange-400',
  'bg-purple-400',
  'bg-pink-400',
];

export function RecentlyActiveSection() {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: ['overview-sessions-stats-30d'],
    queryFn: fetchSessionsStats,
  });

  const activeWorkspaces = useMemo(() => {
    return (data?.byWorkspace ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((ws) => ({
        path: ws.workspacePath,
        name: ws.workspacePath.split('/').pop() ?? ws.workspacePath,
        count: ws.count,
      }));
  }, [data?.byWorkspace]);

  if (activeWorkspaces.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
        {t('dashboard.recentlyActive')}
      </p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {activeWorkspaces.map((ws, i) => (
          <div
            key={ws.path}
            className="flex items-center gap-1.5 rounded-full bg-bg-tertiary px-3 py-1 text-sm shrink-0"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full shrink-0 ${PILL_COLORS[i % PILL_COLORS.length]}`}
            />
            <span className="text-sidebar-foreground/70 font-medium">{ws.name}</span>
            <span className="text-sidebar-foreground/40 text-xs">{ws.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
