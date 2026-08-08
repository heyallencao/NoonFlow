"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { ChatView } from "@/components/chat/ChatView";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { publishRefreshFileTree } from '@/lib/events/app-event-bus';
import { useChatSessionViewStore, EMPTY_SESSION_VIEW } from '@/stores/chat-session-view-store';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { selectChatTimelineSession } from '@/lib/chat/selectors';
import { useSessionQuery, useSessionMessagesQuery } from '@/lib/queries/session-queries';
import {
  getCachedChatSessionView,
  getSessionMetaCacheEntry,
  isResolvedChatSessionCache,
  isTrustedChatSessionViewCache,
} from '@/lib/session-client-cache';
import { getLocalStorageSafe, writeStorageValue } from '@/lib/browser-storage';

interface SplitColumnProps {
  sessionId: string;
  isActive: boolean;
  onClose: () => void;
  onFocus: () => void;
}

export function SplitColumn({ sessionId, isActive, onClose, onFocus }: SplitColumnProps) {
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setPanelOpen } = usePanel();
  const { t } = useTranslation();

  // ── Read from store ──
  const view = useChatSessionViewStore((s) => s.sessions[sessionId]) ?? EMPTY_SESSION_VIEW;
  const timeline = useChatTimelineStore((state) => selectChatTimelineSession(state, sessionId));
  const {
    loading, error, sessionTitle, projectName, sessionWorkingDir,
    sessionResolved, sessionType,
  } = view;
  const { messages } = timeline;

  // ── Store actions ──
  const hydrateSession = useChatSessionViewStore((s) => s.hydrateSession);
  const updateSessionMeta = useChatSessionViewStore((s) => s.updateSessionMeta);
  const storeMergeMessagesFromServer = useChatSessionViewStore((s) => s.mergeMessagesFromServer);
  const storeMarkSessionMissing = useChatSessionViewStore((s) => s.markSessionMissing);
  const storeSetLoading = useChatSessionViewStore((s) => s.setLoading);
  const storeSetError = useChatSessionViewStore((s) => s.setError);
  const storeSetSessionResolved = useChatSessionViewStore((s) => s.setSessionResolved);

  // ── React Query (same pattern as ChatSessionPage) ──
  const sessionQuery = useSessionQuery(sessionId);
  const messagesQuery = useSessionMessagesQuery({
    sessionId,
    limit: 30,
    enabled: sessionResolved && (sessionType || 'chat') === 'chat',
  });

  // ── Hydrate from cache on mount ──
  useEffect(() => {
    const rawCachedView = getCachedChatSessionView(sessionId);
    const cachedView = isTrustedChatSessionViewCache(rawCachedView) ? rawCachedView : null;
    const cachedMeta = getSessionMetaCacheEntry(sessionId);
    const existing = useChatSessionViewStore.getState().sessions[sessionId];
    const existingTimeline = selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);

    if (
      existing?.sessionResolved
      && existingTimeline.messages.length === 0
      && cachedView?.messages.length
    ) {
      hydrateSession(sessionId, {
        messages: cachedView.messages,
        hasMore: cachedView.hasMore,
        loading: false,
        error: null,
        sessionTitle: cachedView.sessionTitle,
        sessionModel: cachedView.sessionModel,
        sessionProviderId: cachedView.sessionProviderId,
        sessionMode: cachedView.sessionMode,
        sessionAssistantRuntime: cachedView.sessionAssistantRuntime,
        sessionType: cachedView.sessionType,
        sessionResolved: true,
        projectName: cachedView.projectName,
        sessionWorkingDir: cachedView.sessionWorkingDir,
      });
      return;
    }

    if (existing?.sessionResolved) return;

    const sessionType = cachedView?.sessionType || cachedMeta?.sessionType || 'chat';

    hydrateSession(sessionId, {
      messages: cachedView?.messages ?? [],
      hasMore: cachedView?.hasMore ?? false,
      loading: !cachedView,
      error: null,
      sessionTitle: cachedView?.sessionTitle || cachedMeta?.title || '',
      sessionModel: cachedView?.sessionModel || '',
      sessionProviderId: cachedView?.sessionProviderId || '',
      sessionMode: cachedView?.sessionMode || '',
      sessionAssistantRuntime: cachedView?.sessionAssistantRuntime || '',
      sessionRuntimeStatus: '',
      sessionRuntimeUpdatedAt: '',
      sessionType,
      sessionResolved: isResolvedChatSessionCache(cachedView, sessionType),
      projectName: cachedView?.projectName || '',
      sessionWorkingDir: cachedView?.sessionWorkingDir || cachedMeta?.workingDirectory || '',
    });
  }, [sessionId, hydrateSession]);

  // ── Session query → write metadata to store ──
  useEffect(() => {
    const session = sessionQuery.data?.session;

    if (!session) {
      if (sessionQuery.isError) {
        const message = sessionQuery.error instanceof Error ? sessionQuery.error.message : 'Failed to load session';
        if (message === 'Session not found') {
          storeMarkSessionMissing(sessionId, message);
        } else {
          const existing = selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);
          if (existing.messages.length === 0) {
            storeSetError(sessionId, message);
            storeSetSessionResolved(sessionId, true);
          }
        }
      }
      return;
    }

    updateSessionMeta(sessionId, {
      sessionTitle: session.title || t("chat.newConversation"),
      sessionModel: session.model || "",
      sessionProviderId: session.provider_id || "",
      sessionMode: session.mode || "code",
      sessionAssistantRuntime: session.assistant_runtime || '',
      sessionRuntimeStatus: session.runtime_status || '',
      sessionRuntimeUpdatedAt: session.runtime_updated_at || '',
      sessionType: session.session_type || "chat",
      projectName: session.project_name || "",
      sessionWorkingDir: session.working_directory || "",
      sessionResolved: true,
      error: null,
    });
  }, [
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    storeMarkSessionMissing,
    storeSetError,
    storeSetSessionResolved,
    t,
    updateSessionMeta,
  ]);

  // ── Messages query → write messages to store ──
  useEffect(() => {
    if (!sessionResolved || (sessionType || 'chat') !== 'chat') return;

    if (messagesQuery.data) {
      // Always reconcile against the local timeline. Stale /messages snapshots can
      // briefly lag behind user/assistant persistence acks, and a canonical replace
      // here would drop locally preserved rows in split-screen mode.
      storeMergeMessagesFromServer(sessionId, messagesQuery.data.messages, messagesQuery.data.hasMore ?? false);
      return;
    }

    if (messagesQuery.isError) {
      const message = messagesQuery.error instanceof Error ? messagesQuery.error.message : 'Failed to load messages';
      if (message === 'Session not found') {
        storeMarkSessionMissing(sessionId, message);
      } else {
        const existing = selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);
        if (existing.messages.length === 0) {
          storeSetError(sessionId, message);
        }
      }
      return;
    }

    if (messagesQuery.isFetching) {
      const existing = selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);
      if (existing.messages.length === 0) {
        storeSetLoading(sessionId, true);
      }
    }
  }, [
    sessionId,
    messagesQuery.data,
    messagesQuery.error,
    messagesQuery.isError,
    messagesQuery.isFetching,
    sessionResolved,
    sessionType,
    storeMergeMessagesFromServer,
    storeMarkSessionMissing,
    storeSetError,
    storeSetLoading,
  ]);

  // When this column becomes active, sync PanelContext
  useEffect(() => {
    if (!isActive) return;
    if (sessionWorkingDir) {
      setWorkingDirectory(sessionWorkingDir);
      writeStorageValue(getLocalStorageSafe(), "noonflow:last-working-directory", sessionWorkingDir);
      publishRefreshFileTree();
    }
    setSessionId(sessionId);
    setPanelOpen(true);
    if (sessionTitle) {
      setPanelSessionTitle(sessionTitle);
    }
  }, [isActive, sessionId, sessionWorkingDir, sessionTitle, setWorkingDirectory, setSessionId, setPanelSessionTitle, setPanelOpen]);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  if (loading && messages.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border-2 transition-colors",
          isActive ? "border-blue-500" : "border-transparent"
        )}
        onClick={onFocus}
      >
        <div className="flex h-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border-2 transition-colors",
          isActive ? "border-blue-500" : "border-transparent"
        )}
        onClick={onFocus}
      >
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border-2 transition-colors",
        isActive ? "border-blue-500" : "border-transparent"
      )}
      onClick={onFocus}
    >
      {/* Compact title bar */}
      <div className="flex h-9 shrink-0 items-center justify-between px-3 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 min-w-0">
          {projectName && (
            <>
              <span className="text-[11px] text-muted-foreground shrink-0">{projectName}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">/</span>
            </>
          )}
          <span className="text-[11px] font-medium truncate">{sessionTitle}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleClose}
        >
          <X className="h-3 w-3" />
          <span className="sr-only">{t("split.closeSplit")}</span>
        </Button>
      </div>
      {/* ChatView */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView
          key={sessionId}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
