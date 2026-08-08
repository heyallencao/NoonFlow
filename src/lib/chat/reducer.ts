import {
  hasOptimisticMessages as detectOptimisticMessages,
} from '@/lib/chat-message-reconciliation';
import {
  finalizeOptimisticAssistantFromSnapshot,
  syncOptimisticAssistantFromSnapshot,
  upsertOptimisticAssistantMessage,
} from '@/lib/chat/optimistic-assistant-reducer';
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

export interface ChatTimelineSessionState {
  messages: Message[];
  hasOptimisticMessages: boolean;
}

export const EMPTY_CHAT_TIMELINE_SESSION: ChatTimelineSessionState = Object.freeze({
  messages: [] as Message[],
  hasOptimisticMessages: false,
});

export type ChatTimelineAction =
  | { type: 'replace-messages'; messages: Message[] }
  | { type: 'merge-messages-from-server'; messages: Message[] }
  | { type: 'append-message'; message: Message }
  | { type: 'ack-persisted-user'; clientMessageId: string; messageId: string; createdAt: string }
  | { type: 'update-message'; messageId: string; updater: (message: Message) => Message }
  | { type: 'remove-message'; messageId: string }
  | { type: 'prepend-messages'; messages: Message[] }
  | { type: 'clear-messages' }
  | { type: 'upsert-optimistic-assistant'; sessionId: string; clientMessageId: string }
  | {
    type: 'sync-optimistic-assistant-from-snapshot';
    sessionId: string;
    snapshot: SnapshotForOptimisticAssistant;
    failureFallbackMessage: string;
  }
  | {
    type: 'finalize-optimistic-assistant-from-snapshot';
    sessionId: string;
    snapshot: SnapshotForOptimisticAssistant;
    failureFallbackMessage: string;
  };

export interface ChatTimelineMutationResult {
  state: ChatTimelineSessionState;
  assistantId?: string | null;
  shouldTransferPending?: boolean;
  stillHasOptimisticMessages?: boolean;
}

function buildTimelineState(
  current: ChatTimelineSessionState,
  messages: Message[],
): ChatTimelineSessionState {
  if (messages === current.messages) {
    return current;
  }

  return {
    messages,
    hasOptimisticMessages: detectOptimisticMessages(messages),
  };
}

export function reduceChatTimeline(
  current: ChatTimelineSessionState,
  action: ChatTimelineAction,
): ChatTimelineMutationResult {
  switch (action.type) {
    case 'replace-messages': {
      return {
        state: buildTimelineState(current, action.messages),
      };
    }

    case 'merge-messages-from-server': {
      const state = buildTimelineState(current, action.messages);
      return {
        state,
        stillHasOptimisticMessages: state.hasOptimisticMessages,
      };
    }

    case 'append-message': {
      return {
        state: buildTimelineState(current, [...current.messages, action.message]),
      };
    }

    case 'ack-persisted-user': {
      const hasPersistedUserAlready = current.messages.some((message) => (
        message.role === 'user' && message.id === action.messageId
      ));
      let matched = false;
      const nextMessages: Message[] = [];

      for (const message of current.messages) {
        const isTargetOptimisticUser = message.role === 'user'
          && message.client_message_id === action.clientMessageId
          && message.id.startsWith('temp-');

        if (!isTargetOptimisticUser) {
          nextMessages.push(message);
          continue;
        }

        matched = true;
        if (hasPersistedUserAlready) {
          continue;
        }

        nextMessages.push({
          ...message,
          id: action.messageId,
          created_at: action.createdAt,
          db_message_id: action.messageId,
          client_message_id: action.clientMessageId,
        });
      }

      if (!matched) {
        return { state: current };
      }

      return {
        state: buildTimelineState(current, nextMessages),
      };
    }

    case 'update-message': {
      let changed = false;
      const nextMessages = current.messages.map((message) => {
        if (message.id !== action.messageId) {
          return message;
        }
        changed = true;
        return action.updater(message);
      });
      if (!changed) {
        return { state: current };
      }
      return {
        state: buildTimelineState(current, nextMessages),
      };
    }

    case 'remove-message': {
      const nextMessages = current.messages.filter((message) => message.id !== action.messageId);
      if (nextMessages.length === current.messages.length) {
        return { state: current };
      }
      return {
        state: buildTimelineState(current, nextMessages),
      };
    }

    case 'prepend-messages': {
      if (action.messages.length === 0) {
        return { state: current };
      }
      return {
        state: buildTimelineState(current, [...action.messages, ...current.messages]),
      };
    }

    case 'clear-messages': {
      if (current.messages.length === 0) {
        return { state: current };
      }
      return {
        state: buildTimelineState(current, []),
      };
    }

    case 'upsert-optimistic-assistant': {
      const next = upsertOptimisticAssistantMessage(
        current.messages,
        action.sessionId,
        action.clientMessageId,
      );
      return {
        state: buildTimelineState(current, next.messages),
        assistantId: next.assistantId,
        shouldTransferPending: next.shouldTransferPending,
      };
    }

    case 'sync-optimistic-assistant-from-snapshot': {
      const next = syncOptimisticAssistantFromSnapshot(
        current.messages,
        action.sessionId,
        action.snapshot,
        { failureFallbackMessage: action.failureFallbackMessage },
      );
      return {
        state: buildTimelineState(current, next.messages),
        assistantId: next.assistantId,
        shouldTransferPending: next.shouldTransferPending,
      };
    }

    case 'finalize-optimistic-assistant-from-snapshot': {
      const next = finalizeOptimisticAssistantFromSnapshot(
        current.messages,
        action.sessionId,
        action.snapshot,
        { failureFallbackMessage: action.failureFallbackMessage },
      );
      return {
        state: buildTimelineState(current, next.messages),
        assistantId: next.assistantId,
        shouldTransferPending: next.shouldTransferPending,
      };
    }

    default: {
      return { state: current };
    }
  }
}
