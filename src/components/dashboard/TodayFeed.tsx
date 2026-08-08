'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { useWorkspaceStore } from '@/stores/workspace-store';

type TranslateFunction = (key: TranslationKey, opts?: Record<string, string | number>) => string;

interface RecentSession {
  id: string;
  title: string;
  workingDirectory: string;
  updatedAt: string;
  messageCount: number;
}

interface SessionsStatsResponse {
  recentSessions: RecentSession[];
}

async function fetchSessionsStats(): Promise<SessionsStatsResponse> {
  const res = await fetch('/api/sessions/stats?days=365');
  if (!res.ok) throw new Error('Failed');
  return res.json();
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

export function TodayFeed() {
  const { t, locale } = useTranslation();
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
  const sessions = candidateSessions.slice(0, 10);

  return (
    <div className="flex flex-col">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] uppercase text-sidebar-foreground/40 mb-8">
        {locale === 'zh' ? '今日动态' : 'Today Feed'}
      </h2>
      <div className="relative border-l border-sidebar-foreground/10 ml-[5px] pl-6 sm:pl-8 flex flex-col gap-8">
        {sessions.length === 0 ? (
          <div className="text-[13px] text-sidebar-foreground/40 py-2">
            {t('dashboard.recentSessions.noSessions')}
          </div>
        ) : (
          sessions.map((session) => {
            const workspace = session.workingDirectory
              ? session.workingDirectory.split('/').pop()
              : '';
            return (
              <div key={session.id} className="relative group">
                <div className="absolute -left-[29px] sm:-left-[37px] top-[7px] h-[3px] w-[3px] rounded-full bg-sidebar-foreground/30 group-hover:bg-emerald-400 group-hover:scale-150 transition-all duration-300" />
                <button
                  onClick={() => router.push('/sessions')}
                  className="flex flex-col items-start text-left w-full gap-1.5 hover:opacity-75 transition-opacity"
                >
                  <div className="flex flex-wrap items-center gap-3 w-full">
                    <span className="text-[11px] font-semibold tracking-wide uppercase text-sidebar-foreground/40">
                      {formatRelativeTime(session.updatedAt, t)}
                    </span>
                    {workspace && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-sidebar-foreground/10" />
                        <span className="text-[11px] font-semibold tracking-wide uppercase text-blue-400/70">
                          {workspace}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-[15px] sm:text-[17px] font-light text-sidebar-foreground/90 leading-relaxed">
                    {session.title || t('chat.newConversation')}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
