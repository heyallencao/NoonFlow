'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ChatView } from '@/components/chat/ChatView';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading02Icon } from '@hugeicons/core-free-icons';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { SessionTabs } from '@/components/layout/SessionTabs';
import {
  getCachedChatSessionView,
  getSessionMetaCacheEntry,
  isResolvedChatSessionCache,
  isTrustedChatSessionViewCache,
} from '@/lib/session-client-cache';
import { publishRefreshFileTree } from '@/lib/events/app-event-bus';
import { publishSessionUpdated } from '@/lib/events/session-refresh-hub';
import { useSessionMessagesQuery, useSessionQuery } from '@/lib/queries/session-queries';
import { useSessionStore } from '@/stores/session-store';
import { useChatSessionViewStore, EMPTY_SESSION_VIEW } from '@/stores/chat-session-view-store';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { selectChatTimelineSession } from '@/lib/chat/selectors';
import { getLocalStorageSafe, writeStorageValue } from '@/lib/browser-storage';

export default function ChatSessionPage() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const sessionId = id ?? '';
  const pathname = usePathname();
  const { setWorkingDirectory, setSessionId, setSessionTitle: setPanelSessionTitle, setPanelOpen } = usePanel();
  const { t } = useTranslation();
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const isCurrentRouteSession = pathname === `/chat/${sessionId}`;

  // ── Read from store ──
  const view = useChatSessionViewStore((s) => s.sessions[sessionId]) ?? EMPTY_SESSION_VIEW;
  const timeline = useChatTimelineStore((state) => selectChatTimelineSession(state, sessionId));
  const {
    loading, error,
    sessionTitle,
    sessionType, sessionWorkingDir, sessionResolved,
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

  // ── React Query ──
  const sessionQuery = useSessionQuery(sessionId);
  const messagesQuery = useSessionMessagesQuery({
    sessionId,
    limit: 30,
    enabled: Boolean(sessionId) && sessionResolved && sessionType === 'chat',
  });

  // ── Hydrate from cache / store on id change ──
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

    // If store already has resolved data AND has messages in timeline, skip cache hydration
    if (existing?.sessionResolved && existingTimeline.messages.length > 0) return;

    const sType = cachedView?.sessionType || cachedMeta?.sessionType || 'chat';
    const cacheResolvesSession = isResolvedChatSessionCache(cachedView, sType);

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
      sessionType: sType,
      sessionResolved: cacheResolvesSession,
      projectName: cachedView?.projectName || '',
      sessionWorkingDir: cachedView?.sessionWorkingDir || cachedMeta?.workingDirectory || '',
    });
  }, [sessionId, hydrateSession]);

  // ── Sync current session to session-store ──
  useEffect(() => {
    setCurrentSession(sessionId, sessionType);
  }, [sessionId, sessionType, setCurrentSession]);

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

    // Terminal sessions are now rendered inside chat view (embedded panel mode).
    // Do not redirect back to /terminal/:id, otherwise /terminal -> /chat plus
    // this branch causes an infinite redirect loop.
    const normalizedSessionType = (session.session_type || 'chat') === 'terminal' ? 'chat' : (session.session_type || 'chat');

    if (isCurrentRouteSession && session.working_directory) {
      setWorkingDirectory(session.working_directory);
      writeStorageValue(getLocalStorageSafe(), 'noonflow:last-working-directory', session.working_directory);
      publishRefreshFileTree();
    }

    const title = session.title || t('chat.newConversation');
    if (isCurrentRouteSession) {
      setSessionId(sessionId);
      setPanelOpen(true);
      setPanelSessionTitle(title);
    }

    updateSessionMeta(sessionId, {
      sessionTitle: title,
      sessionModel: session.model || '',
      sessionProviderId: session.provider_id || '',
      sessionMode: session.mode || 'code',
      sessionAssistantRuntime: session.assistant_runtime || '',
      sessionRuntimeStatus: session.runtime_status || '',
      sessionRuntimeUpdatedAt: session.runtime_updated_at || '',
      sessionType: normalizedSessionType,
      projectName: session.project_name || '',
      sessionWorkingDir: session.working_directory || '',
      sessionResolved: true,
      error: null,
    });

    // Keep session-tabs runtime dots in sync after server-side recovery updates.
    publishSessionUpdated({
      sessionId,
      title,
      sessionType: normalizedSessionType,
      workingDirectory: session.working_directory || '',
    });
  }, [
    sessionId,
    sessionQuery.data,
    sessionQuery.error,
    sessionQuery.isError,
    isCurrentRouteSession,
    setPanelOpen,
    setPanelSessionTitle,
    setSessionId,
    setWorkingDirectory,
    storeMarkSessionMissing,
    storeSetError,
    storeSetSessionResolved,
    t,
    updateSessionMeta,
  ]);

  // ── Messages query → write messages to store ──
  useEffect(() => {
    if (!sessionResolved || sessionType !== 'chat') return;

    if (messagesQuery.data) {
      // Always use compatibility reconciliation to avoid clobbering recent
      // local timeline state (e.g. remount/focus races where server rows lag
      // behind persisted ack snapshots).
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

  const showContentLoading = sessionType !== 'chat' || (loading && messages.length === 0);

  if (!id) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isCurrentRouteSession) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SessionTabs
        activeSessionId={sessionId}
        activeSessionTitle={sessionTitle}
        workingDirectory={sessionWorkingDir}
        activeSessionType={sessionType}
      />
      {error ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-destructive font-medium">{error}</p>
            <Link href="/chat" className="text-sm text-muted-foreground hover:underline">
              Start a new chat
            </Link>
          </div>
        </div>
      ) : showContentLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <HugeiconsIcon icon={Loading02Icon} className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ChatView
          key={sessionId}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
