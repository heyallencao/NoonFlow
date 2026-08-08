'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, FolderIcon, GitBranchIcon, TimeIcon, MessageMultiple01Icon, Clock01Icon, CpuIcon } from '@hugeicons/core-free-icons';
import type { Message } from '@/types';
import { parseMessageContent } from '@/types';
import { MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { getRuntimeBadgeClassName, getRuntimeLabel } from '@/lib/runtime-display';

interface SessionInfo {
  id: string;
  runtime: 'claude_code' | 'codex';
  title: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  model: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionDetail {
  info: SessionInfo;
  messages: Message[];
}

interface TimelineMessageGroup {
  role: Message['role'];
  messages: Array<{ message: Message; index: number }>;
}

const getReplayReturnToStorageKey = (sessionId: string) => `noonflow:replay-return-to:${sessionId}`;

function sanitizeReturnToPath(value?: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

async function fetchSessionDetail(id: string, runtime?: string | null): Promise<SessionDetail> {
  const searchParams = new URLSearchParams();
  if (runtime === 'claude_code' || runtime === 'codex') {
    searchParams.set('runtime', runtime);
  }
  const query = searchParams.toString();
  const res = await fetch(`/api/session-replays/${id}${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch session');
  return res.json();
}

function formatMessageTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function groupMessagesByRole(messages: Message[]): TimelineMessageGroup[] {
  const groups: TimelineMessageGroup[] = [];

  messages.forEach((message, index) => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.role === message.role) {
      lastGroup.messages.push({ message, index });
      return;
    }

    groups.push({
      role: message.role,
      messages: [{ message, index }],
    });
  });

  return groups;
}

function TimelineMessageCard({ message, index }: { message: Message; index: number }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isUser = message.role === 'user';
  const contentBlocks = parseMessageContent(message.content);
  const textBlocks = contentBlocks.filter((block) => block.type === 'text');
  const toolBlocks = contentBlocks.filter((block) => block.type === 'tool_use' || block.type === 'tool_result');

  const pairedTools: Array<{
    name: string;
    input: unknown;
    result?: string;
    isError?: boolean;
  }> = [];
  const toolUseMap = new Map<string, typeof toolBlocks[0]>();

  for (const block of toolBlocks) {
    if (block.type === 'tool_use') {
      toolUseMap.set(block.id, block);
    }
  }

  for (const block of toolBlocks) {
    if (block.type === 'tool_use') {
      const toolResult = toolBlocks.find(
        (candidate) => candidate.type === 'tool_result' && candidate.tool_use_id === block.id
      ) as { content: string; is_error?: boolean } | undefined;

      pairedTools.push({
        name: block.name,
        input: block.input,
        result: toolResult ? toolResult.content : 'ok',
        isError: toolResult ? toolResult.is_error : undefined,
      });
    } else if (block.type === 'tool_result' && !toolUseMap.has(block.tool_use_id)) {
      pairedTools.push({
        name: 'tool_result',
        input: {},
        result: block.content,
        isError: block.is_error,
      });
    }
  }

  const fullText = textBlocks.map((block) => (block as { text: string }).text).join('\n\n');
  const truncateLength = 150;
  const isTextTruncated = fullText.length > truncateLength;
  const previewText = isTextTruncated ? `${fullText.slice(0, truncateLength)}...` : fullText;

  return (
    <div
      className={`relative transition-all duration-300 ease-in-out ${
        !isExpanded && isTextTruncated ? 'cursor-pointer rounded-lg hover:bg-white/[0.03]' : ''
      }`}
      onClick={() => {
        if (!isExpanded && isTextTruncated) setIsExpanded(true);
      }}
    >
      {isExpanded && (
        <div
          className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-pointer bg-orange-500/40 transition-colors hover:bg-orange-500/80"
          title="点击收起"
          onClick={(event) => {
            event.stopPropagation();
            setIsExpanded(false);
          }}
        />
      )}

      <div className={`px-1 py-2 ${isExpanded ? 'animate-in fade-in duration-500 rounded-lg bg-white/[0.02]' : ''}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-muted-foreground/60">
            {formatMessageTime(message.created_at)}
          </span>
          {isExpanded && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-3 py-0 text-[11px] font-bold text-orange-500 shadow-sm transition-all hover:scale-105 border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20"
              onClick={(event) => {
                event.stopPropagation();
                setIsExpanded(false);
              }}
            >
              收起全文
            </Button>
          )}
        </div>

        {!isUser && pairedTools.length > 0 && (
          <div className={fullText ? 'mb-4' : 'mb-1'}>
            <ToolActionsGroup
              tools={pairedTools.map((tool, toolIndex) => ({
                id: `hist-${index}-${toolIndex}`,
                name: tool.name,
                input: tool.input,
                result: tool.result,
                isError: tool.isError,
              }))}
            />
          </div>
        )}

        {fullText && (
          !isExpanded && isTextTruncated ? (
            <div className="relative flex flex-col gap-2">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
                {previewText}
              </div>
              <div className="mt-1 flex items-center">
                <span
                  className={`inline-flex cursor-pointer items-center gap-1 text-xs font-bold transition-colors ${
                    isUser ? 'text-blue-500 hover:text-blue-400' : 'text-emerald-500 hover:text-emerald-400'
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsExpanded(true);
                  }}
                >
                  点击展开全文
                </span>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-col gap-1 pl-2">
              <div className="w-full">
                {textBlocks.map((block, textIndex) => (
                  block.type === 'text' && (
                    <MessageContent key={textIndex} className="!ml-0 !border-0 !bg-transparent !p-0 group-[.is-user]:!bg-transparent w-full max-w-none">
                      <MessageResponse className="w-full">{block.text}</MessageResponse>
                    </MessageContent>
                  )
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TimelineRoleGroup({ group, isLast }: { group: TimelineMessageGroup; isLast: boolean }) {
  const isUser = group.role === 'user';
  const firstMessage = group.messages[0]?.message;
  const lastMessage = group.messages[group.messages.length - 1]?.message;
  const firstTime = firstMessage ? formatMessageTime(firstMessage.created_at) : '';
  const lastTime = lastMessage ? formatMessageTime(lastMessage.created_at) : '';
  const showTimeRange = firstTime && lastTime && firstTime !== lastTime;

  return (
    <div className="group relative pl-10 pb-8">
      {!isLast && (
        <div className="absolute left-[11px] top-[24px] bottom-[-8px] w-[2px] bg-border/40 transition-colors group-hover:bg-border/60" />
      )}

      <div
        className={`absolute left-[12px] top-[18px] z-30 h-3 w-3 -translate-x-1/2 rounded-full ring-4 ring-bg-primary transition-all duration-300 ${
          isUser
            ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
            : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
        }`}
      />

      <div className="sticky top-0 z-20 mb-3 flex items-center gap-2 rounded-b-lg bg-bg-primary/95 px-1 py-3 shadow-[0_4px_10px_-4px_rgba(0,0,0,0.1)] backdrop-blur-sm">
        <span className={`text-[11px] font-bold uppercase tracking-wider ${
          isUser ? 'text-blue-500' : 'text-emerald-500'
        }`}>
          {isUser ? 'User' : 'Assistant'}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground/60">
          {showTimeRange ? `${firstTime} - ${lastTime}` : firstTime}
        </span>
        {group.messages.length > 1 && (
          <span className="text-[11px] text-muted-foreground/50">
            {group.messages.length} 条消息
          </span>
        )}
      </div>

      <div className="space-y-0">
        {group.messages.map(({ message, index }, messageIndex) => (
          <div
            key={message.id || index}
            className={messageIndex > 0 ? 'border-t border-border/20 pt-3 mt-3' : ''}
          >
            <TimelineMessageCard message={message} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionTimeline() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.id as string;
  const runtime = searchParams.get('runtime');
  const returnToRaw = searchParams.get('returnTo');
  const queryReturnTo = sanitizeReturnToPath(returnToRaw);
  const storedReturnTo =
    typeof window !== 'undefined'
      ? sanitizeReturnToPath(window.sessionStorage.getItem(getReplayReturnToStorageKey(sessionId)))
      : null;
  const returnTo = queryReturnTo ?? storedReturnTo ?? '/sessions';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (queryReturnTo) {
      window.sessionStorage.setItem(getReplayReturnToStorageKey(sessionId), queryReturnTo);
      return;
    }

    if (!storedReturnTo) {
      window.sessionStorage.removeItem(getReplayReturnToStorageKey(sessionId));
    }
  }, [queryReturnTo, sessionId, storedReturnTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-detail', sessionId, runtime],
    queryFn: () => fetchSessionDetail(sessionId, runtime),
    enabled: !!sessionId,
  });

  const groupedMessages = useMemo(() => groupMessagesByRole(data?.messages ?? []), [data?.messages]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-500">
          加载会话失败
        </p>
      </div>
    );
  }

  const { info } = data;
  const startDate = new Date(info.createdAt);
  const endDate = new Date(info.updatedAt);
  const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary">
      <div className="shrink-0 flex items-center h-12 px-6 border-b border-border/40 bg-bg-secondary/30 relative z-50" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(returnTo)}
          className="flex items-center -ml-2 h-8 gap-2 px-3 text-sm font-medium text-muted-foreground hover:text-foreground bg-transparent hover:bg-secondary/80 rounded-md transition-colors cursor-pointer relative z-50"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
          <span>返回列表</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
        <div className="border-b border-border/40 bg-gradient-to-b from-card/60 to-bg-primary/60 backdrop-blur-md py-6">
          <div className="mx-auto max-w-6xl px-6">
            <div className="pl-10">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="space-y-4 flex-1 min-w-0">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground line-clamp-2 break-words">
                    {info.title}
                  </h1>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                    <div className="flex items-center gap-1.5 bg-blue-500/10 px-2 py-1 rounded-md text-blue-500">
                      <HugeiconsIcon icon={FolderIcon} className="h-3.5 w-3.5" />
                      <span className="truncate max-w-[150px]">{info.projectName}</span>
                    </div>

                    {info.gitBranch && (
                      <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-md text-emerald-500">
                        <HugeiconsIcon icon={GitBranchIcon} className="h-3.5 w-3.5" />
                        <span className="truncate max-w-[150px]">{info.gitBranch}</span>
                      </div>
                    )}

                    {info.model && (
                      <div className="flex items-center gap-1.5 bg-purple-500/10 px-2 py-1 rounded-md text-purple-500">
                        <HugeiconsIcon icon={CpuIcon} className="h-3.5 w-3.5" />
                        <span className="truncate max-w-[150px]">{info.model}</span>
                      </div>
                    )}

                    <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${getRuntimeBadgeClassName(info.runtime)}`}>
                      <span>{getRuntimeLabel(info.runtime)}</span>
                    </div>

                    <div className="flex items-center gap-1.5 px-1 text-muted-foreground">
                      <HugeiconsIcon icon={TimeIcon} className="h-3.5 w-3.5 opacity-70" />
                      {startDate.toLocaleDateString('zh-CN')} {startDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col shrink-0 gap-2.5 rounded-xl bg-card/50 py-3 px-4 min-w-[8rem]">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-blue-500 mb-0.5 font-medium">
                      <HugeiconsIcon icon={MessageMultiple01Icon} className="h-3.5 w-3.5" />
                      <span>消息</span>
                    </div>
                    <span className="text-sm font-bold font-mono text-foreground">{info.messageCount}</span>
                  </div>

                  <div className="h-px bg-border/50 self-stretch" />

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500 mb-0.5 font-medium">
                      <HugeiconsIcon icon={Clock01Icon} className="h-3.5 w-3.5" />
                      <span>历时</span>
                    </div>
                    <span className="text-sm font-bold font-mono text-foreground">
                      {durationMinutes}<span className="text-[10px] ml-0.5 text-muted-foreground">m</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl py-8 px-6">
          <div className="flex flex-col">
            {groupedMessages.map((group, index) => (
              <TimelineRoleGroup
                key={`${group.role}-${group.messages[0]?.message.id || index}`}
                group={group}
                isLast={index === groupedMessages.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
