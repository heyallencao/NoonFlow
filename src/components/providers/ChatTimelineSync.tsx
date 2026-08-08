'use client';

import { useEffect } from 'react';
import { transferPendingToMessage } from '@/lib/image-ref-store';
import {
  clearSnapshot,
  getActiveSessionIds,
  getSnapshot,
  subscribeGlobal,
} from '@/lib/stream-session-manager';
import { useChatSessionViewStore } from '@/stores/chat-session-view-store';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';

const MODEL_FAILURE_FALLBACK_MESSAGE = '模型有问题，调用失败，请稍后重试。';

/**
 * Global stream-to-timeline synchronization.
 *
 * This keeps canonical chat messages in sync with stream snapshots outside
 * ChatView so view components only render state instead of orchestrating it.
 */
export function ChatTimelineSync() {
  useEffect(() => {
    const syncSnapshot = (snapshot: NonNullable<ReturnType<typeof getSnapshot>>) => {
      const sessionId = snapshot.sessionId;
      const timelineStore = useChatTimelineStore.getState();
      const viewStore = useChatSessionViewStore.getState();

      if (
        snapshot.clientMessageId
        && snapshot.persistedUserMessageId
        && snapshot.persistedUserCreatedAt
      ) {
        timelineStore.ackPersistedUser(
          sessionId,
          snapshot.clientMessageId,
          snapshot.persistedUserMessageId,
          snapshot.persistedUserCreatedAt,
        );
      }

      timelineStore.syncOptimisticAssistantFromSnapshot(
        sessionId,
        snapshot,
        MODEL_FAILURE_FALLBACK_MESSAGE,
      );
      viewStore.syncMessagesFromTimeline(sessionId);
    };

    for (const sessionId of getActiveSessionIds()) {
      const snapshot = getSnapshot(sessionId);
      if (snapshot) {
        syncSnapshot(snapshot);
      }
    }

    const unsubscribe = subscribeGlobal((event) => {
      const sessionId = event.snapshot.sessionId;
      const timelineStore = useChatTimelineStore.getState();
      const viewStore = useChatSessionViewStore.getState();

      if (
        event.snapshot.clientMessageId
        && event.snapshot.persistedUserMessageId
        && event.snapshot.persistedUserCreatedAt
      ) {
        timelineStore.ackPersistedUser(
          sessionId,
          event.snapshot.clientMessageId,
          event.snapshot.persistedUserMessageId,
          event.snapshot.persistedUserCreatedAt,
        );
      }

      if (event.type === 'completed') {
        const result = timelineStore.finalizeOptimisticAssistantFromSnapshot(
          sessionId,
          event.snapshot,
          MODEL_FAILURE_FALLBACK_MESSAGE,
        );
        if (result.shouldTransferPending && result.assistantId) {
          transferPendingToMessage(result.assistantId);
        }
        clearSnapshot(sessionId);
        // Keep the final runtime snapshot available so global UI like SessionTabs
        // can immediately reflect completed / stopped / error states before any
        // slower DB-backed session list refresh catches up.
        viewStore.syncMessagesFromTimeline(sessionId, { persistCache: true });
        return;
      }

      if (event.snapshot.phase === 'active') {
        syncSnapshot(event.snapshot);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return null;
}
