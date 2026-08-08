'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlayIcon, Message02Icon } from '@hugeicons/core-free-icons';
import { getRuntimeBadgeClassName, getRuntimeLabel } from '@/lib/runtime-display';

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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface SessionReplayListProps {
  limit?: number;
  returnTo?: string;
}

export function SessionReplayList({ limit, returnTo = '/sessions' }: SessionReplayListProps) {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ['session-replays'],
    queryFn: fetchSessionReplays,
  });

  const sessions = useMemo(() => {
    const source = data?.sessions ?? [];
    const sorted = [...source].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    if (typeof limit === 'number' && limit > 0) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }, [data?.sessions, limit]);

  if (error) {
    return <p className="text-sm text-red-500">加载会话失败</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无历史会话</p>;
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const totalMessages = session.userMessageCount + session.assistantMessageCount;
        const href = `/sessions/${session.sessionId}?runtime=${session.runtime}&returnTo=${encodeURIComponent(returnTo)}`;

        return (
          <div
            key={`${session.runtime}-${session.sessionId}`}
            className="group flex items-start gap-4 rounded-lg bg-card p-3.5 transition-all hover:bg-white/[0.03] cursor-pointer"
            onClick={() => router.push(href)}
          >
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-blue-500 dark:text-blue-400 font-mono">
                  {session.projectName}
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                  {session.sessionId.slice(0, 8)}
                </span>
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getRuntimeBadgeClassName(session.runtime)}`}>
                  {getRuntimeLabel(session.runtime)}
                </span>
              </div>

              <p className="mt-1 line-clamp-2 text-sm font-normal leading-normal text-foreground/80">
                {session.preview || 'No preview available'}
              </p>

              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <span className="tabular-nums">{formatRelativeTime(session.updatedAt)}</span>
                {totalMessages > 0 && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      <HugeiconsIcon icon={Message02Icon} className="h-3.5 w-3.5" />
                      {totalMessages}
                    </span>
                  </>
                )}
                {session.model && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="truncate max-w-[10rem]">{session.model}</span>
                  </>
                )}
              </div>
            </div>

            <button
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-all shrink-0 hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                router.push(href);
              }}
            >
              <HugeiconsIcon icon={PlayIcon} className="h-3.5 w-3.5" />
              <span>Replay</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
