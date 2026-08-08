import { create } from 'zustand';
import {
  EMPTY_CHAT_TIMELINE_SESSION,
  reduceChatTimeline,
  type ChatTimelineAction,
  type ChatTimelineMutationResult,
  type ChatTimelineSessionState,
} from '@/lib/chat/reducer';
import type { Message, SessionStreamSnapshot } from '@/types';

type SnapshotForOptimisticAssistant = Pick<
  SessionStreamSnapshot,
  | 'clientMessageId'
  | 'phase'
  | 'streamingReasoning'
  | 'streamingContent'
  | 'toolUses'
  | 'toolResults'
  | 'streamingBlocks'
  | 'finalMessageContent'
  | 'tokenUsage'
  | 'error'
  | 'persistedMessageId'
  | 'persistedRevision'
>;

export interface ChatTimelineStoreState {
  sessions: Record<string, ChatTimelineSessionState>;

  replaceMessages: (sessionId: string, messages: Message[]) => void;
  mergeMessagesFromServer: (sessionId: string, messages: Message[]) => boolean;
  appendMessage: (sessionId: string, message: Message) => void;
  ackPersistedUser: (sessionId: string, clientMessageId: string, messageId: string, createdAt: string) => void;
  updateMessage: (sessionId: string, messageId: string, updater: (message: Message) => Message) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  prependMessages: (sessionId: string, messages: Message[]) => void;
  clearMessages: (sessionId: string) => void;
  upsertOptimisticAssistant: (sessionId: string, clientMessageId: string) => string;
  syncOptimisticAssistantFromSnapshot: (
    sessionId: string,
    snapshot: SnapshotForOptimisticAssistant,
    failureFallbackMessage: string,
  ) => { assistantId: string | null; shouldTransferPending: boolean };
  finalizeOptimisticAssistantFromSnapshot: (
    sessionId: string,
    snapshot: SnapshotForOptimisticAssistant,
    failureFallbackMessage: string,
  ) => { assistantId: string | null; shouldTransferPending: boolean };
  evictSession: (sessionId: string) => void;
}

export const useChatTimelineStore = create<ChatTimelineStoreState>((set) => {
  const mutateSession = <T>(
    sessionId: string,
    action: ChatTimelineAction,
    readResult: (mutation: ChatTimelineMutationResult) => T,
  ): T => {
    let captured!: T;

    set((state) => {
      const current = state.sessions[sessionId] ?? EMPTY_CHAT_TIMELINE_SESSION;
      const mutation = reduceChatTimeline(current, action);
      captured = readResult(mutation);

      if (mutation.state === current) {
        return state;
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: mutation.state,
        },
      };
    });

    return captured;
  };

  return {
    sessions: {},

    replaceMessages: (sessionId, messages) => {
      mutateSession(sessionId, { type: 'replace-messages', messages }, () => undefined);
    },

    mergeMessagesFromServer: (sessionId, messages) => (
      mutateSession(
        sessionId,
        { type: 'merge-messages-from-server', messages },
        (mutation) => mutation.stillHasOptimisticMessages ?? false,
      )
    ),

    appendMessage: (sessionId, message) => {
      mutateSession(sessionId, { type: 'append-message', message }, () => undefined);
    },

    ackPersistedUser: (sessionId, clientMessageId, messageId, createdAt) => {
      mutateSession(
        sessionId,
        { type: 'ack-persisted-user', clientMessageId, messageId, createdAt },
        () => undefined,
      );
    },

    updateMessage: (sessionId, messageId, updater) => {
      mutateSession(sessionId, { type: 'update-message', messageId, updater }, () => undefined);
    },

    removeMessage: (sessionId, messageId) => {
      mutateSession(sessionId, { type: 'remove-message', messageId }, () => undefined);
    },

    prependMessages: (sessionId, messages) => {
      mutateSession(sessionId, { type: 'prepend-messages', messages }, () => undefined);
    },

    clearMessages: (sessionId) => {
      mutateSession(sessionId, { type: 'clear-messages' }, () => undefined);
    },

    upsertOptimisticAssistant: (sessionId, clientMessageId) => (
      mutateSession(
        sessionId,
        {
          type: 'upsert-optimistic-assistant',
          sessionId,
          clientMessageId,
        },
        (mutation) => mutation.assistantId ?? '',
      )
    ),

    syncOptimisticAssistantFromSnapshot: (sessionId, snapshot, failureFallbackMessage) => (
      mutateSession(
        sessionId,
        {
          type: 'sync-optimistic-assistant-from-snapshot',
          sessionId,
          snapshot,
          failureFallbackMessage,
        },
        (mutation) => ({
          assistantId: mutation.assistantId ?? null,
          shouldTransferPending: mutation.shouldTransferPending ?? false,
        }),
      )
    ),

    finalizeOptimisticAssistantFromSnapshot: (sessionId, snapshot, failureFallbackMessage) => (
      mutateSession(
        sessionId,
        {
          type: 'finalize-optimistic-assistant-from-snapshot',
          sessionId,
          snapshot,
          failureFallbackMessage,
        },
        (mutation) => ({
          assistantId: mutation.assistantId ?? null,
          shouldTransferPending: mutation.shouldTransferPending ?? false,
        }),
      )
    ),

    evictSession: (sessionId) => {
      set((state) => {
        if (!state.sessions[sessionId]) {
          return state;
        }

        const sessions = { ...state.sessions };
        delete sessions[sessionId];
        return { sessions };
      });
    },
  };
});
