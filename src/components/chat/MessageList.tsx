'use client';

import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import type {
  Message,
  PermissionRequestEvent,
  StreamingMessageBlock,
  ChildActivity,
  ToolResultInfo,
  ToolUseInfo,
} from '@/types';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';

const GLOBAL_SCROLL_MEMORY_KEY = '__noonflowChatScrollMemory__' as const;
const GLOBAL_COLLAPSE_MEMORY_KEY = '__noonflowChatLoadedHistoryCollapse__' as const;
const BOTTOM_THRESHOLD_PX = 8;
const RECENT_MESSAGES_WINDOW = 40;

interface SavedScrollPosition {
  scrollTop: number;
  wasAtBottom: boolean;
}

function getScrollMemory(): Map<string, SavedScrollPosition> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_SCROLL_MEMORY_KEY]) {
    globalObject[GLOBAL_SCROLL_MEMORY_KEY] = new Map<string, SavedScrollPosition>();
  }
  return globalObject[GLOBAL_SCROLL_MEMORY_KEY] as Map<string, SavedScrollPosition>;
}

function getCollapseMemory(): Map<string, boolean> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_COLLAPSE_MEMORY_KEY]) {
    globalObject[GLOBAL_COLLAPSE_MEMORY_KEY] = new Map<string, boolean>();
  }
  return globalObject[GLOBAL_COLLAPSE_MEMORY_KEY] as Map<string, boolean>;
}

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.clientHeight - node.scrollTop <= BOTTOM_THRESHOLD_PX;
}

function ScrollOnStream({ isStreaming, messageCount }: { isStreaming: boolean; messageCount: number }) {
  const { scrollToBottom, isAtBottom } = useStickToBottomContext();
  const hasMounted = useRef(false);
  const wasStreaming = useRef(isStreaming);
  const prevCount = useRef(messageCount);
  const isAtBottomRef = useRef(isAtBottom);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    if (!hasMounted.current) {
      prevCount.current = messageCount;
      return;
    }

    if (messageCount > prevCount.current && isAtBottomRef.current) {
      scrollToBottom('instant');
    }
    prevCount.current = messageCount;
  }, [messageCount, scrollToBottom]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      wasStreaming.current = isStreaming;
      return;
    }

    if (isStreaming && !wasStreaming.current && isAtBottomRef.current) {
      scrollToBottom('instant');
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, scrollToBottom]);

  return null;
}

function ScrollOnLayoutChange({
  layoutSignal,
  followLayout,
}: {
  layoutSignal: number;
  followLayout: boolean;
}) {
  const { scrollToBottom } = useStickToBottomContext();

  useEffect(() => {
    if (!followLayout) {
      return;
    }
    scrollToBottom('instant');
  }, [followLayout, layoutSignal, scrollToBottom]);

  return null;
}

function ScrollOnSendSignal({ signal }: { signal: number }) {
  const { scrollToBottom } = useStickToBottomContext();
  const prevSignalRef = useRef(signal);

  useEffect(() => {
    if (signal === prevSignalRef.current) {
      return;
    }
    prevSignalRef.current = signal;
    scrollToBottom('instant');
  }, [signal, scrollToBottom]);

  return null;
}

function PersistScrollPosition({ sessionId }: { sessionId: string }) {
  const { scrollRef, scrollToBottom, isAtBottom } = useStickToBottomContext();
  const isAtBottomRef = useRef(isAtBottom);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useLayoutEffect(() => {
    let cleanup = () => {};
    const frameId = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) {
        return;
      }

      const memory = getScrollMemory().get(sessionId);
      if (memory) {
        if (memory.wasAtBottom) {
          scrollToBottom('instant');
        } else {
          node.scrollTop = memory.scrollTop;
        }
      } else {
        scrollToBottom('instant');
      }

      const save = () => {
        getScrollMemory().set(sessionId, {
          scrollTop: node.scrollTop,
          wasAtBottom: isAtBottomRef.current || isNearBottom(node),
        });
      };

      save();
      node.addEventListener('scroll', save, { passive: true });
      cleanup = () => {
        save();
        node.removeEventListener('scroll', save);
      };
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      cleanup();
    };
  }, [sessionId, scrollRef, scrollToBottom]);

  return null;
}

interface HistoryFoldCardProps {
  hiddenLoadedCount: number;
  collapsed: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onToggle: () => void;
  onLoadMore?: () => void;
}

function HistoryFoldCard({
  hiddenLoadedCount,
  collapsed,
  hasMore,
  loadingMore,
  onToggle,
  onLoadMore,
}: HistoryFoldCardProps) {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-subtle bg-bg-tertiary px-4 py-3">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/45" />
            {t('messageList.earlierContext')}
          </div>
          <p className="text-sm font-medium text-foreground/90">
            {collapsed
              ? t('messageList.showLoadedHistory', { count: hiddenLoadedCount })
              : t('messageList.hideLoadedHistory')}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {collapsed
              ? t('messageList.loadedHistoryHintCollapsed')
              : t('messageList.loadedHistoryHintExpanded')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasMore && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="rounded-full border border-border/70 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? t('messageList.loading') : t('messageList.loadEarlier')}
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-full border border-border/70 bg-foreground/[0.04] px-3 py-1.5 text-xs font-medium text-foreground/85 transition-colors hover:bg-foreground/[0.08]"
          >
            {collapsed ? t('messageList.expandLoadedHistory') : t('messageList.collapseLoadedHistory')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MessageListProps {
  sessionId: string;
  messages: Message[];
  activeStreamingClientMessageId?: string | null;
  showStandaloneStreamingMessage?: boolean;
  streamingContent: string;
  streamingReasoning: string;
  showReasoning?: boolean;
  generativeUIEnabled?: boolean;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingBlocks?: StreamingMessageBlock[];
  streamingToolOutput?: string;
  statusText?: string;
  startedAt?: number;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
  childActivities?: ChildActivity[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  matchedMessageIds?: Set<string>;
  searchQuery?: string;
  activeMatchMessageId?: string | null;
  activeMatchOccurrenceIndex?: number | null;
  layoutSignal?: number;
  followLayout?: boolean;
  forceScrollSignal?: number;
}

export function MessageList({
  sessionId,
  messages,
  activeStreamingClientMessageId = null,
  showStandaloneStreamingMessage = false,
  streamingContent,
  streamingReasoning,
  showReasoning = false,
  generativeUIEnabled = true,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingBlocks = [],
  streamingToolOutput,
  statusText,
  startedAt,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  onForceStop,
  childActivities = [],
  hasMore,
  loadingMore,
  onLoadMore,
  matchedMessageIds,
  searchQuery,
  activeMatchMessageId = null,
  activeMatchOccurrenceIndex = null,
  layoutSignal = 0,
  followLayout = false,
  forceScrollSignal = 0,
}: MessageListProps) {
  const anchorIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(messages.length);
  const [showAllLoadedMessages, setShowAllLoadedMessages] = useState<boolean>(() => {
    return getCollapseMemory().get(sessionId) ?? false;
  });
  const hasActiveSearch = Boolean(searchQuery?.trim());

  const handleToggleLoadedHistory = () => {
    setShowAllLoadedMessages((prev) => {
      const next = !prev;
      getCollapseMemory().set(sessionId, next);
      return next;
    });
  };

  const hiddenLoadedCount = Math.max(0, messages.length - RECENT_MESSAGES_WINDOW);
  const shouldCollapseLoadedHistory = hiddenLoadedCount > 0 && !showAllLoadedMessages;

  const visibleMessages = useMemo(() => {
    if (!shouldCollapseLoadedHistory) {
      return messages;
    }
    return messages.slice(hiddenLoadedCount);
  }, [hiddenLoadedCount, messages, shouldCollapseLoadedHistory]);

  const handleLoadMore = () => {
    if (messages.length > 0) {
      anchorIdRef.current = visibleMessages[0]?.id || messages[0].id;
    }
    onLoadMore?.();
  };

  useEffect(() => {
    if (anchorIdRef.current && messages.length > prevMessageCountRef.current) {
      const el = document.getElementById(`msg-${anchorIdRef.current}`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
      }
      anchorIdRef.current = null;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  if (messages.length === 0 && !isStreaming && childActivities.length === 0) {
    return <div className="flex-1" />;
  }

  const hasActiveStreamingInMap = Boolean(
    (isStreaming || childActivities.length > 0)
    && activeStreamingClientMessageId
    && messages.some((m) => m.role === 'assistant' && m.client_message_id === activeStreamingClientMessageId),
  );

  return (
    <Conversation initial="instant">
      <PersistScrollPosition sessionId={sessionId} />
      <ScrollOnStream isStreaming={isStreaming} messageCount={messages.length} />
      <ScrollOnLayoutChange layoutSignal={layoutSignal} followLayout={followLayout} />
      <ScrollOnSendSignal signal={forceScrollSignal} />
      <ConversationContent className="mx-auto max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 py-6 gap-6">
        {(hasMore || hiddenLoadedCount > 0) && (
          <HistoryFoldCard
            hiddenLoadedCount={hiddenLoadedCount}
            collapsed={shouldCollapseLoadedHistory}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onToggle={handleToggleLoadedHistory}
            onLoadMore={handleLoadMore}
          />
        )}

        {visibleMessages.map((message) => {
          const isMatch = hasActiveSearch && Boolean(matchedMessageIds?.has(message.id));
          const activeOccurrenceIndex = activeMatchMessageId === message.id
            ? activeMatchOccurrenceIndex
            : null;
          const isActiveStreamingAssistant = Boolean(
            (isStreaming || childActivities.length > 0)
            && activeStreamingClientMessageId
            && message.role === 'assistant'
            && message.client_message_id === activeStreamingClientMessageId
          );
          return (
            <div
              key={message.id}
              id={`msg-${message.id}`}
              className="rounded-lg"
            >
              <div id={isActiveStreamingAssistant ? 'msg-streaming' : undefined}>
                <MessageItem
                  message={message}
                  showReasoning={showReasoning}
                  generativeUIEnabled={generativeUIEnabled}
                  searchQuery={isMatch ? (searchQuery || '') : ''}
                  activeSearchOccurrenceIndex={isMatch ? activeOccurrenceIndex : null}
                  streamingState={isActiveStreamingAssistant ? {
                    isStreaming,
                    toolUses,
                    toolResults,
                    streamingToolOutput,
                    statusText,
                    startedAt,
                    pendingPermission,
                    onPermissionResponse,
                    permissionResolved,
                    onForceStop,
                    childActivities,
                  } : undefined}
                />
              </div>
            </div>
          );
        })}

        {showStandaloneStreamingMessage && (
          <div
            id={hasActiveStreamingInMap ? undefined : 'msg-streaming'}
            className="rounded-lg"
          >
            <StreamingMessage
              sessionId={sessionId}
              content={streamingContent}
              reasoning={streamingReasoning}
              showReasoning={showReasoning}
              generativeUIEnabled={generativeUIEnabled}
              isStreaming={isStreaming}
              toolUses={toolUses}
              toolResults={toolResults}
              streamingBlocks={streamingBlocks}
              streamingToolOutput={streamingToolOutput}
              statusText={statusText}
              startedAt={startedAt}
              pendingPermission={pendingPermission}
              onPermissionResponse={onPermissionResponse}
              permissionResolved={permissionResolved}
              onForceStop={onForceStop}
              childActivities={childActivities}
            />
          </div>
        )}

      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
