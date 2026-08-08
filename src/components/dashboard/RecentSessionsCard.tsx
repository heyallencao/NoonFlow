'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import type { TranslationKey } from '@/i18n';
import { Message02Icon, ArrowRight01Icon, PlusSignIcon } from '@hugeicons/core-free-icons';

import { useTranslation } from '@/hooks/useTranslation';
import { StatusBadge } from '@/components/ui/status-badge';
import { getRuntimeBadgeClassName, getRuntimeLabel } from '@/lib/runtime-display';
import { Button } from '@/components/ui/button';

type TranslateFunction = (
  key: TranslationKey,
  opts?: Record<string, string | number>
) => string;

interface ReplaySessionInfo {
  runtime: 'claude_code' | 'codex';
  sessionId: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  model: string;
  preview: string;
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ReplaySessionsResponse {
  sessions: ReplaySessionInfo[];
}

async function fetchSessionReplays(): Promise<ReplaySessionsResponse> {
  const res = await fetch('/api/session-replays');
  if (!res.ok) {
    throw new Error('Failed to fetch session replays');
  }
  return res.json();
}

function formatRelativeTime(dateString: string, t: TranslateFunction): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return t('chatList.justNow') || '刚刚';
  }
  if (diffMins < 60) {
    return t('chatList.minutesAgo', { n: diffMins }) || `${diffMins}分钟`;
  }
  if (diffHours < 24) {
    return t('chatList.hoursAgo', { n: diffHours }) || `${diffHours}小时`;
  }
  return t('chatList.daysAgo', { n: diffDays }) || `${diffDays}天`;
}

export function RecentSessionsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const replaysQuery = useQuery({
    queryKey: ['overview-recent-session-replays'],
    queryFn: fetchSessionReplays,
  });

  const recentSessions = useMemo(() => {
    const sessions = replaysQuery.data?.sessions ?? [];
    return [...sessions]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [replaysQuery.data?.sessions]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-bg-secondary p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HugeiconsIcon icon={Message02Icon} className="h-4 w-4" />
          </div>
          <h3 className="text-[15px] font-bold tracking-tight text-foreground">
            {t('dashboard.recentSessions.title') || '最近会话'}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push('/chat')}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-bg-hover"
          title="New session"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1">
        {recentSessions.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-bg-primary/50 p-6 text-center">
            <HugeiconsIcon icon={Message02Icon} className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground/80">
              {t('dashboard.recentSessions.empty') || '暂无会话。'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentSessions.map((session) => {
              const href = `/sessions/${session.sessionId}?runtime=${session.runtime}&returnTo=${encodeURIComponent('/dashboard')}`;

              return (
                <button
                  key={`${session.runtime}:${session.sessionId}`}
                  onClick={() => router.push(href)}
                  className="group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all bg-bg-primary hover:bg-bg-hover hover:shadow-sm"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary/70 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <HugeiconsIcon icon={Message02Icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-bold text-foreground transition-colors group-hover:text-primary">
                        {session.preview || t('chat.newConversation') || '新对话'}
                      </p>
                      <span className={`shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-tight uppercase ${getRuntimeBadgeClassName(session.runtime)}`}>
                        {getRuntimeLabel(session.runtime)}
                      </span>
                    </div>
                    <p className="truncate text-[11px] font-medium text-muted-foreground/60 mt-0.5">
                      {session.cwd || session.projectPath || '-'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge variant="info" className="bg-transparent border-none text-[10px] font-bold text-muted-foreground/50 px-0">
                      {formatRelativeTime(session.updatedAt, t)}
                    </StatusBadge>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-1 group-hover:text-primary"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
