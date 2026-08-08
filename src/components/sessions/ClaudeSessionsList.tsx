'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlayIcon, Message02Icon } from '@hugeicons/core-free-icons';

interface SessionInfo {
  sessionId: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  preview: string;
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionsResponse {
  sessions: SessionInfo[];
}

async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch('/api/claude-sessions');
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

// Format relative time like "2m ago", "1h ago", "6d ago"
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

interface ClaudeSessionsListProps {
  limit?: number;
}

export function ClaudeSessionsList({ limit }: ClaudeSessionsListProps) {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ['claude-sessions'],
    queryFn: fetchSessions,
  });

  const sessions = useMemo(() => {
    const source = data?.sessions ?? [];
    const sorted = [...source].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (typeof limit === 'number' && limit > 0) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }, [data?.sessions, limit]);

  if (error) {
    return (
      <p className="text-sm text-red-500">
        加载会话失败
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        暂无历史会话
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const totalMessages = session.userMessageCount + session.assistantMessageCount;

        return (
          <div
            key={session.sessionId}
            className="group flex items-start gap-4 p-3.5 rounded-lg bg-card hover:bg-white/[0.03] cursor-pointer transition-all"
            onClick={() => router.push(`/sessions/${session.sessionId}`)}
          >
            {/* Left content */}
            <div className="flex-1 min-w-0">
              {/* Title Section */}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-blue-500 dark:text-blue-400 font-mono">
                  {session.projectName}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">
                  {session.sessionId.slice(0, 8)}
                </span>
              </div>

              {/* Preview text - main content */}
              <p className="text-sm font-normal text-foreground/80 line-clamp-2 leading-normal mt-1">
                {session.preview || "No preview available"}
              </p>

              {/* Meta info */}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground font-mono">
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
              </div>
            </div>

            {/* Replay button */}
            <button
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-all shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/sessions/${session.sessionId}`);
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
