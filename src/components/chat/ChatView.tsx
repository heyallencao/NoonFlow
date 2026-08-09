'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import type { AssistantRuntime } from '@/types';
import { SETTING_KEYS } from '@/types';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { usePanel } from '@/hooks/usePanel';
import { BatchExecutionDashboard, BatchContextSync } from './batch-image-gen';
import { useTerminalPanel } from '@/hooks/useTerminalPanel';
import { useTranslation } from '@/hooks/useTranslation';
import { useRuntimeStore } from '@/stores/runtime-store';
import {
  useChatSessionViewStore,
  EMPTY_SESSION_VIEW,
} from '@/stores/chat-session-view-store';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { selectChatTimelineSession } from '@/lib/chat/selectors';
import {
  getChatRolloutMode,
  shouldShowStandaloneStreamingFallback,
} from '@/lib/chat-rollout';
import { cn } from '@/lib/utils';
import { SearchOverlay, TerminalDock } from './chat-view/layout-panels';
import { useChatStreamController } from './chat-view/use-chat-stream-controller';
import { useChatSessionSideEffects } from './chat-view/use-chat-session-side-effects';
import { useChatImageNotices } from './chat-view/use-chat-image-notices';
import { useChatHistoryPagination } from './chat-view/use-chat-history-pagination';
import { useChatCommandHandler } from './chat-view/use-chat-command-handler';
import { useChatSearch } from './chat-view/use-chat-search';
import { useChatTerminalLayout } from './chat-view/use-chat-terminal-layout';
import { useChatStreamStatusSync } from './chat-view/use-chat-stream-status-sync';
import { ContextUsageBar } from './ContextUsageBar';
import { useContextUsage } from '@/hooks/useContextUsage';

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const { t } = useTranslation();
  const { setStreamingSessionId, workingDirectory, setPendingApprovalSessionId } = usePanel();

  // ── Terminal panel state ──
  const terminalPanel = useTerminalPanel(workingDirectory);
  const terminalPanelHeight = terminalPanel.height;

  // ── Read session metadata plus canonical timeline messages ──
  const view = useChatSessionViewStore((s) => s.sessions[sessionId]) ?? EMPTY_SESSION_VIEW;
  const timeline = useChatTimelineStore((state) => selectChatTimelineSession(state, sessionId));
  const messages = timeline.messages;
  const { hasMore } = view;
  const appSettingsQuery = useAppSettingsQuery();
  const storedDefaultRuntime = appSettingsQuery.data?.settings[SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME];
  const defaultAssistantRuntime: AssistantRuntime =
    storedDefaultRuntime === 'codex' || storedDefaultRuntime === 'pi'
      ? storedDefaultRuntime
      : 'claude_code';
  const currentAssistantRuntime: AssistantRuntime =
    view.sessionAssistantRuntime || defaultAssistantRuntime;
  const currentModel = currentAssistantRuntime === 'codex'
    ? (view.sessionModel || appSettingsQuery.data?.settings[SETTING_KEYS.CODEX_DEFAULT_MODEL] || '')
    : currentAssistantRuntime === 'pi'
    ? (view.sessionModel || appSettingsQuery.data?.settings[SETTING_KEYS.PI_DEFAULT_MODEL] || '')
    : (view.sessionModel || appSettingsQuery.data?.settings[SETTING_KEYS.DEFAULT_MODEL] || '');
  const currentProviderId = currentAssistantRuntime === 'claude_code'
    ? (view.sessionProviderId || '')
    : '';
  const mode = view.sessionMode || 'code';

  // ── Store actions ──
  const timelineAppendMessage = useChatTimelineStore((s) => s.appendMessage);
  const timelineUpsertOptimisticAssistant = useChatTimelineStore((s) => s.upsertOptimisticAssistant);
  const timelineRemoveMessage = useChatTimelineStore((s) => s.removeMessage);
  const storeSyncMessagesFromTimeline = useChatSessionViewStore((s) => s.syncMessagesFromTimeline);
  const storeSetMessages = useChatSessionViewStore((s) => s.setMessages);
  const storeMergeMessagesFromServer = useChatSessionViewStore((s) => s.mergeMessagesFromServer);
  const storePrependMessages = useChatSessionViewStore((s) => s.prependMessages);
  const storeClearMessages = useChatSessionViewStore((s) => s.clearMessages);
  const storeUpdateMeta = useChatSessionViewStore((s) => s.updateSessionMeta);

  // Stream snapshot from the manager — drives all streaming UI
  const streamSnapshot = useRuntimeStore((state) => state.snapshots[sessionId] ?? null);

  // Derive rendering state from snapshot
  const isStreaming = streamSnapshot?.phase === 'active';
  const streamingContent = streamSnapshot?.streamingContent ?? '';
  const streamingReasoning = streamSnapshot?.streamingReasoning ?? '';
  const toolUses = streamSnapshot?.toolUses ?? [];
  const toolResults = streamSnapshot?.toolResults ?? [];
  const streamingBlocks = streamSnapshot?.streamingBlocks ?? [];
  const streamingToolOutput = streamSnapshot?.streamingToolOutput ?? '';
  const statusText = streamSnapshot?.statusText;
  const pendingPermission = streamSnapshot?.pendingPermission ?? null;
  const permissionResolved = streamSnapshot?.permissionResolved ?? null;
  const streamingStartedAt = streamSnapshot?.startedAt ?? 0;
  const activeStreamingClientMessageId = streamSnapshot?.clientMessageId ?? null;
  const rolloutMode = getChatRolloutMode();
  const hasActiveStreamingAssistantMessage = useMemo(() => Boolean(
    activeStreamingClientMessageId
    && messages.some((message) => (
      message.role === 'assistant' && message.client_message_id === activeStreamingClientMessageId
    ))
  ), [activeStreamingClientMessageId, messages]);
  const showStandaloneStreamingFallback = shouldShowStandaloneStreamingFallback(rolloutMode, {
    isStreaming,
    hasActiveStreamingAssistantMessage,
    activeStreamingClientMessageId,
  });
  const showReasoning = appSettingsQuery.data?.settings[SETTING_KEYS.CHAT_REASONING_ENABLED] === 'true';
  const generativeUIEnabled = appSettingsQuery.data?.settings[SETTING_KEYS.GENERATIVE_UI_ENABLED] !== 'false';
  const contextUsageBarEnabled = appSettingsQuery.data?.settings[SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED] !== 'false';
  const [forceScrollSignal, setForceScrollSignal] = useState(0);
  const widgetRetryTimeoutRef = useRef<number | null>(null);
  const widgetSendStateRef = useRef({
    isStreaming: false,
    isSendLocked: false,
    isStopping: false,
  });
  const widgetSendMessageRef = useRef<((content: string) => Promise<void> | void) | null>(null);
  const handleUserMessageSent = useCallback(() => {
    setForceScrollSignal((current) => current + 1);
  }, []);

  const {
    chatViewportHeight,
    terminalDragLimitReached,
    isTerminalResizing,
    layoutSignal,
    setChatViewContainerRef,
    setMessageInputContainerRef,
    handleTerminalResizeStart,
    handleTerminalResize,
    handleTerminalResizeEnd,
  } = useChatTerminalLayout({
    isTerminalOpen: terminalPanel.isOpen,
    terminalPanelHeight,
    setTerminalPanelHeight: terminalPanel.setHeight,
  });

  const {
    handleModeChange,
    handleProviderModelChange,
    handleModelChange,
    clearSessionMessages,
  } = useChatSessionSideEffects({
    sessionId,
    updateSessionMeta: storeUpdateMeta,
    clearMessages: storeClearMessages,
    setMessages: storeSetMessages,
    mergeMessagesFromServer: storeMergeMessagesFromServer,
  });

  const {
    consumePendingImageNotices,
  } = useChatImageNotices({ sessionId });

  // Context usage bar
  const {
    totalTokens,
    usedPct,
    contextWindowSize,
    lastTurnUsage,
    source: contextSource,
    compaction,
  } = useContextUsage(sessionId, currentModel, currentProviderId, currentAssistantRuntime);

  const {
    loadingMore,
    loadEarlierMessages,
  } = useChatHistoryPagination({
    sessionId,
    hasMore,
    messages,
    prependMessages: storePrependMessages,
  });

  const {
    isSendLocked,
    isStopping,
    updateSendLock,
    sendMessage,
    stopStreaming,
    handlePermissionResponse,
  } = useChatStreamController({
    sessionId,
    sessionResolved: view.sessionResolved,
    isStreaming,
    mode,
    currentModel,
    currentProviderId,
    currentAssistantRuntime,
    pendingPermission,
    permissionResolved,
    setPendingApprovalSessionId,
    onModeChange: handleModeChange,
    consumePendingImageNotices,
    onUserMessageSent: handleUserMessageSent,
    appendMessage: timelineAppendMessage,
    upsertOptimisticAssistant: timelineUpsertOptimisticAssistant,
    removeMessage: timelineRemoveMessage,
    syncMessagesFromTimeline: storeSyncMessagesFromTimeline,
  });

  useChatStreamStatusSync({
    sessionId,
    isStreaming,
    isStopping,
    pendingPermission,
    permissionResolved,
    setStreamingSessionId,
    setPendingApprovalSessionId,
    updateSendLock,
  });

  const { handleCommand } = useChatCommandHandler({
    sessionId,
    messages,
    onSendMessage: sendMessage,
    onClearMessages: clearSessionMessages,
    appendMessage: timelineAppendMessage,
    syncMessagesFromTimeline: storeSyncMessagesFromTimeline,
  });

  useEffect(() => {
    widgetSendStateRef.current = {
      isStreaming,
      isSendLocked,
      isStopping,
    };
    widgetSendMessageRef.current = sendMessage;
  }, [isSendLocked, isStopping, isStreaming, sendMessage]);

  useEffect(() => {
    const globalWindow = window as Window & {
      __widgetSendMessage?: (content: string) => void;
      __widgetSendMessageLastAt?: number;
    };
    const clearPendingWidgetRetry = () => {
      if (widgetRetryTimeoutRef.current !== null) {
        window.clearTimeout(widgetRetryTimeoutRef.current);
        widgetRetryTimeoutRef.current = null;
      }
    };

    if (!generativeUIEnabled) {
      clearPendingWidgetRetry();
      delete globalWindow.__widgetSendMessage;
      globalWindow.__widgetSendMessageLastAt = 0;
      return;
    }

    const sendFromWidget = (content: string, attempt = 0) => {
      const normalized = content.trim().slice(0, 1000);
      if (!normalized) {
        return;
      }
      const {
        isStreaming: streamingNow,
        isSendLocked: sendLockedNow,
        isStopping: stoppingNow,
      } = widgetSendStateRef.current;
      const now = Date.now();
      const lastSentAt = globalWindow.__widgetSendMessageLastAt || 0;
      if (now - lastSentAt < 1200) {
        return;
      }
      if (streamingNow || sendLockedNow || stoppingNow) {
        if (attempt >= 12) {
          return;
        }
        clearPendingWidgetRetry();
        widgetRetryTimeoutRef.current = window.setTimeout(() => {
          widgetRetryTimeoutRef.current = null;
          if (globalWindow.__widgetSendMessage === sendFromWidget) {
            sendFromWidget(normalized, attempt + 1);
          }
        }, 250);
        return;
      }
      clearPendingWidgetRetry();
      globalWindow.__widgetSendMessageLastAt = now;
      void widgetSendMessageRef.current?.(normalized);
    };

    globalWindow.__widgetSendMessage = sendFromWidget;
    return () => {
      clearPendingWidgetRetry();
      if (globalWindow.__widgetSendMessage === sendFromWidget) {
        delete globalWindow.__widgetSendMessage;
        globalWindow.__widgetSendMessageLastAt = 0;
      }
    };
  }, [generativeUIEnabled]);

  const {
    searchInputRef,
    isGlobalSearchVisible,
    globalSearchQuery,
    normalizedGlobalSearchQuery,
    totalSearchMatchCount,
    activeMatchDisplayIndex,
    matchedMessageIds,
    activeTerminalMatchIndex,
    activeChatMatchMessageId,
    activeChatMatchOccurrenceIndex,
    setTerminalSearchMatchCount,
    closeGlobalSearch,
    handleGlobalSearchQueryChange,
    navigateSearchTarget,
  } = useChatSearch({
    messages,
    streamingContent,
    showStandaloneStreamingFallback,
    isTerminalOpen: terminalPanel.isOpen,
  });

  return (
    <div ref={setChatViewContainerRef} className="relative flex h-full min-h-0 flex-col">
      <SearchOverlay
        isVisible={isGlobalSearchVisible}
        query={globalSearchQuery}
        normalizedQuery={normalizedGlobalSearchQuery}
        totalMatchCount={totalSearchMatchCount}
        activeMatchDisplayIndex={activeMatchDisplayIndex}
        placeholder={t('chatSearch.placeholder')}
        shortcutLabel={t('chatSearch.shortcut')}
        closeLabel={t('chatSearch.close')}
        zeroResultsLabel={t('chatSearch.results', { count: 0 })}
        onClose={closeGlobalSearch}
        onQueryChange={handleGlobalSearchQueryChange}
        onNavigateNext={() => navigateSearchTarget(1)}
        onNavigatePrevious={() => navigateSearchTarget(-1)}
        inputRef={searchInputRef}
      />

      <div
        className={cn(
          'flex min-h-0 flex-col',
          isGlobalSearchVisible && 'pt-14'
        )}
        style={{ height: chatViewportHeight }}
      >
        <MessageList
          sessionId={sessionId}
          messages={messages}
          activeStreamingClientMessageId={activeStreamingClientMessageId}
          showStandaloneStreamingMessage={showStandaloneStreamingFallback}
          streamingContent={streamingContent}
          streamingReasoning={streamingReasoning}
          showReasoning={showReasoning}
          generativeUIEnabled={generativeUIEnabled}
          isStreaming={isStreaming}
          toolUses={toolUses}
          toolResults={toolResults}
          streamingBlocks={streamingBlocks}
          streamingToolOutput={streamingToolOutput}
          statusText={statusText}
          startedAt={streamingStartedAt}
          pendingPermission={pendingPermission}
          onPermissionResponse={handlePermissionResponse}
          permissionResolved={permissionResolved}
          onForceStop={stopStreaming}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadEarlierMessages}
          matchedMessageIds={matchedMessageIds}
          searchQuery={normalizedGlobalSearchQuery}
          activeMatchMessageId={activeChatMatchMessageId}
          activeMatchOccurrenceIndex={activeChatMatchOccurrenceIndex}
          layoutSignal={layoutSignal}
          followLayout={terminalPanel.isOpen || isTerminalResizing}
          forceScrollSignal={forceScrollSignal}
        />
        {/* Batch image generation panels — shown above the input area */}
        <BatchExecutionDashboard />
        <BatchContextSync />

        {/* Only show when there are messages or actively streaming */}
        {contextUsageBarEnabled && (messages.length > 0 || isStreaming) && (
          <div className="px-4 pt-1">
            <div className="mx-auto flex w-full max-w-[960px] justify-start">
              <ContextUsageBar
                totalTokens={totalTokens}
                usedPct={usedPct}
                contextWindowSize={contextWindowSize}
                lastTurnUsage={lastTurnUsage}
                source={contextSource}
                compaction={compaction}
                isStreaming={isStreaming}
              />
            </div>
          </div>
        )}

        <MessageInput
          onSend={sendMessage}
          onCommand={handleCommand}
          onStop={stopStreaming}
          disabled={isSendLocked || isStopping || !view.sessionResolved}
          isStreaming={isStreaming}
          sessionId={sessionId}
          modelName={currentModel}
          onModelChange={handleModelChange}
          providerId={currentProviderId}
          onProviderModelChange={handleProviderModelChange}
          assistantRuntime={currentAssistantRuntime}
          workingDirectory={workingDirectory}
          mode={mode}
          onModeChange={handleModeChange}
          terminalOpen={terminalPanel.isOpen}
          onToggleTerminal={terminalPanel.togglePanel}
          showQuickSkills={messages.length === 0 && !isStreaming}
          containerRef={setMessageInputContainerRef}
        />
      </div>

      <TerminalDock
        isOpen={terminalPanel.isOpen}
        terminalSessionId={terminalPanel.terminalSessionId}
        workingDirectory={workingDirectory}
        terminalHeight={terminalPanel.height}
        terminalDragLimitReached={terminalDragLimitReached}
        upperLimitLabel={t('terminalPanel.dragLimitReached')}
        searchQuery={normalizedGlobalSearchQuery}
        activeTerminalMatchIndex={activeTerminalMatchIndex}
        onResizeStart={handleTerminalResizeStart}
        onResize={handleTerminalResize}
        onResizeEnd={handleTerminalResizeEnd}
        onClose={terminalPanel.closePanel}
        onToggle={terminalPanel.togglePanel}
        onSearchMatchesChange={setTerminalSearchMatchCount}
      />
    </div>
  );
}
