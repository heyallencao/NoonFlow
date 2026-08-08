'use client';

import { useEffect, useRef } from 'react';
import { recoverSessionSnapshot } from '@/lib/stream-session-manager';
import { selectChatTimelineSession } from '@/lib/chat/selectors';
import { useChatSessionViewStore } from '@/stores/chat-session-view-store';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { useRuntimeStore } from '@/stores/runtime-store';

const COMPLETION_SYNC_RETRY_DELAYS_MS = [200, 600, 1_500, 3_000, 6_000, 10_000, 16_000, 24_000];
const LIFECYCLE_RECOVERY_RUNTIME_STATUSES = new Set(['running', 'stopping']);

interface SyncCandidate {
  sessionId: string;
  hasOptimisticMessages: boolean;
  hasAssistantMessage: boolean;
  hasProjectedPersistedAssistant: boolean;
  shouldForceRetry: boolean;
}

function hasOptimisticTimelineMessages(sessionId: string): boolean {
  return selectChatTimelineSession(useChatTimelineStore.getState(), sessionId).hasOptimisticMessages;
}

function getSyncCandidate(sessionId: string): SyncCandidate | null {
  const view = useChatSessionViewStore.getState().sessions[sessionId];
  if (!view?.sessionResolved || view.sessionType !== 'chat') {
    return null;
  }

  const snapshot = useRuntimeStore.getState().snapshots[sessionId] ?? null;
  if (snapshot?.phase === 'active') {
    return null;
  }

  const timeline = selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);
  const hasOptimisticMessages = timeline.hasOptimisticMessages;
  const hasPersistedAssistant = timeline.messages.some((message) => message.role === 'assistant');
  const hasProjectedPersistedAssistant = timeline.messages.some((message) => (
    message.role === 'assistant'
    && message.id.startsWith('temp-assistant-')
    && Boolean(message.db_message_id)
  ));
  const shouldForceRetry = LIFECYCLE_RECOVERY_RUNTIME_STATUSES.has(view.sessionRuntimeStatus)
    && !hasPersistedAssistant;

  if (!hasOptimisticMessages && !hasProjectedPersistedAssistant && !shouldForceRetry) {
    return null;
  }

  return {
    sessionId,
    hasOptimisticMessages,
    hasAssistantMessage: hasPersistedAssistant,
    hasProjectedPersistedAssistant,
    shouldForceRetry,
  };
}

export function ChatLifecycleSync() {
  const timerMapRef = useRef<Map<string, number>>(new Map());
  const activeLoopTokenRef = useRef<Map<string, string>>(new Map());
  const candidateKeyRef = useRef<Map<string, string>>(new Map());
  const pendingPermissionRecoveryRef = useRef<Set<string>>(new Set());
  const syncInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timerMap = timerMapRef.current;
    const activeLoopTokens = activeLoopTokenRef.current;
    const candidateKeys = candidateKeyRef.current;
    const pendingPermissionRecoveries = pendingPermissionRecoveryRef.current;
    const syncInFlight = syncInFlightRef.current;

    const clearRetry = (sessionId: string) => {
      const timerId = timerMap.get(sessionId);
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
        timerMap.delete(sessionId);
      }
    };

    const syncLatestMessages = async (sessionId: string): Promise<boolean> => {
      if (syncInFlight.has(sessionId)) {
        return hasOptimisticTimelineMessages(sessionId);
      }

      syncInFlight.add(sessionId);
      try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/messages?limit=30`, {
          cache: 'no-store',
        });
        if (res.status === 404 || !res.ok) {
          return res.status === 404 ? false : hasOptimisticTimelineMessages(sessionId);
        }

        const data = await res.json() as { messages?: unknown; hasMore?: boolean };
        if (Array.isArray(data.messages)) {
          return useChatSessionViewStore
            .getState()
            .mergeMessagesFromServer(sessionId, data.messages, data.hasMore ?? false);
        }
      } catch {
        // best effort
      } finally {
        syncInFlight.delete(sessionId);
      }

      return hasOptimisticTimelineMessages(sessionId);
    };

    const runSyncLoop = async (
      sessionId: string,
      forceRetry: boolean,
      attempt: number,
      loopToken: string,
    ) => {
      if (activeLoopTokens.get(sessionId) !== loopToken) {
        return;
      }

      const stillHasOptimisticMessages = await syncLatestMessages(sessionId);
      if (activeLoopTokens.get(sessionId) !== loopToken) {
        return;
      }

      const latestCandidate = getSyncCandidate(sessionId);
      const shouldContinue = attempt < COMPLETION_SYNC_RETRY_DELAYS_MS.length
        && (
          stillHasOptimisticMessages
          || Boolean(latestCandidate?.hasProjectedPersistedAssistant)
          || (forceRetry && Boolean(latestCandidate?.shouldForceRetry) && !latestCandidate?.hasAssistantMessage)
        );

      if (!shouldContinue) {
        clearRetry(sessionId);
        activeLoopTokens.delete(sessionId);
        return;
      }

      const timerId = window.setTimeout(() => {
        void runSyncLoop(sessionId, forceRetry, attempt + 1, loopToken);
      }, COMPLETION_SYNC_RETRY_DELAYS_MS[attempt]);
      timerMap.set(sessionId, timerId);
    };

    const startSyncLoop = (sessionId: string, forceRetry: boolean) => {
      clearRetry(sessionId);
      const loopToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      activeLoopTokens.set(sessionId, loopToken);
      void runSyncLoop(sessionId, forceRetry, 0, loopToken);
    };

    const scanSessions = () => {
      const sessions = useChatSessionViewStore.getState().sessions;
      const seenSessionIds = new Set(Object.keys(sessions));

      for (const [sessionId, view] of Object.entries(sessions)) {
        const snapshot = useRuntimeStore.getState().snapshots[sessionId] ?? null;
        const waitingPermission = view.sessionResolved
          && view.sessionType === 'chat'
          && view.sessionRuntimeStatus === 'waiting_permission'
          && !snapshot;

        if (waitingPermission && !pendingPermissionRecoveries.has(sessionId)) {
          pendingPermissionRecoveries.add(sessionId);
          void recoverSessionSnapshot(sessionId).finally(() => {
            pendingPermissionRecoveries.delete(sessionId);
          });
        } else if (!waitingPermission) {
          pendingPermissionRecoveries.delete(sessionId);
        }

        const candidate = getSyncCandidate(sessionId);
        const nextKey = candidate
          ? [
              view.sessionRuntimeStatus || 'idle',
              view.sessionRuntimeUpdatedAt || 'unknown',
              candidate.hasOptimisticMessages ? 'optimistic' : 'stable',
              candidate.hasAssistantMessage ? 'assistant' : 'no-assistant',
              candidate.hasProjectedPersistedAssistant ? 'projected-persisted' : 'not-projected',
              candidate.shouldForceRetry ? 'force-retry' : 'no-force-retry',
            ].join(':')
          : null;
        const previousKey = candidateKeys.get(sessionId) ?? null;

        if (!nextKey) {
          clearRetry(sessionId);
          activeLoopTokens.delete(sessionId);
          candidateKeys.delete(sessionId);
          continue;
        }

        if (candidate && previousKey !== nextKey) {
          candidateKeys.set(sessionId, nextKey);
          startSyncLoop(sessionId, candidate.shouldForceRetry);
        }
      }

      for (const sessionId of Array.from(candidateKeys.keys())) {
        if (!seenSessionIds.has(sessionId)) {
          clearRetry(sessionId);
          activeLoopTokens.delete(sessionId);
          candidateKeys.delete(sessionId);
          pendingPermissionRecoveries.delete(sessionId);
        }
      }
    };

    const restartRelevantSessions = () => {
      const sessions = useChatSessionViewStore.getState().sessions;
      for (const sessionId of Object.keys(sessions)) {
        const candidate = getSyncCandidate(sessionId);
        if (candidate) {
          startSyncLoop(sessionId, candidate.shouldForceRetry);
        }
      }
    };

    const unsubscribeView = useChatSessionViewStore.subscribe(() => {
      scanSessions();
    });
    const unsubscribeTimeline = useChatTimelineStore.subscribe(() => {
      scanSessions();
    });
    const unsubscribeRuntime = useRuntimeStore.subscribe(() => {
      scanSessions();
    });

    const handleFocus = () => {
      restartRelevantSessions();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        restartRelevantSessions();
      }
    };
    const handleOnline = () => {
      restartRelevantSessions();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    scanSessions();

    return () => {
      unsubscribeView();
      unsubscribeTimeline();
      unsubscribeRuntime();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);

      for (const timerId of timerMap.values()) {
        window.clearTimeout(timerId);
      }
      timerMap.clear();
      activeLoopTokens.clear();
      candidateKeys.clear();
      pendingPermissionRecoveries.clear();
      syncInFlight.clear();
    };
  }, []);

  return null;
}
