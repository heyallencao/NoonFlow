'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';
import { useWorkspaceStore } from '@/stores/workspace-store';

type TranslateFunction = (key: TranslationKey, opts?: Record<string, string | number>) => string;

interface RecentSession {
  id: string;
  title: string;
  workingDirectory: string;
  updatedAt: string;
  messageCount: number;
  assistantRuntime: string;
}

interface SessionsStatsResponse {
  recentSessions: RecentSession[];
}

async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  const res = await fetch('/api/sessions/stats?days=365');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

function truncateTitle(title: string, maxChars: number = 16): string {
  if (title.length <= maxChars) {
    return title;
  }
  return `${title.slice(0, maxChars)}...`;
}

function formatRelativeTime(dateString: string, t: TranslateFunction): string {
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) {
    return '--';
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleString();
  }
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('chatList.justNow');
  if (diffMins < 60) return t('chatList.minutesAgo', { n: diffMins });
  if (diffHours < 24) return t('chatList.hoursAgo', { n: diffHours });
  return t('chatList.daysAgo', { n: diffDays });
}

export function NewRecentSessionsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const workspacePaths = useWorkspaceStore((s) => s.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);
  const visibleWorkspaces = workspacePaths.filter((workspace) => !hiddenWorkspaces.includes(workspace));

  const { data } = useQuery({
    queryKey: ['overview-sessions-stats-365d'],
    queryFn: fetchSessionsStats,
  });

  const allSessions = data?.recentSessions ?? [];
  const inVisibleWorkspaces = allSessions.filter((session) =>
    visibleWorkspaces.some((workspace) =>
      session.workingDirectory === workspace
      || session.workingDirectory.startsWith(`${workspace}/`)
    )
  );
  const candidateSessions = inVisibleWorkspaces.length > 0 ? inVisibleWorkspaces : allSessions;
  const sessions = candidateSessions.slice(0, 4);

  return (
    <div className="flex flex-col rounded-2xl bg-bg-secondary p-4 shadow-sm h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-sidebar-foreground">{t('dashboard.recentSessions.title')}</span>
        <button
          type="button"
          onClick={() => router.push('/sessions')}
          aria-label={t('dashboard.recentSessions.title')}
          className="group shrink-0"
        >
          <OverviewActionArrow />
        </button>
      </div>

      <div className="flex flex-col gap-1 flex-1">
        {sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-sidebar-foreground/40">
            {t('dashboard.recentSessions.noSessions')}
          </div>
        ) : (
          sessions.map((session) => {
            const workspace = session.workingDirectory
              ? session.workingDirectory.split('/').pop()
              : '';
            return (
              <button
                key={session.id}
                onClick={() => router.push('/sessions')}
                className="group flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-bg-tertiary transition-colors w-full"
              >
                <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                <span className="flex-1 truncate text-xs text-sidebar-foreground/80 group-hover:text-sidebar-foreground">
                  {truncateTitle(session.title || t('chat.newConversation'))}
                </span>
                {workspace && (
                  <span className="shrink-0 text-[10px] text-blue-400 font-medium max-w-[64px] truncate">
                    {workspace}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-sidebar-foreground/40">
                  {formatRelativeTime(session.updatedAt, t)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
