import {
  applySnapshotToOptimisticAssistantMessage,
  buildOptimisticAssistantMessage,
  buildTerminalAssistantContent,
} from '@/lib/chat-streaming-message';
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

export interface OptimisticAssistantMutationResult {
  messages: Message[];
  assistantId: string | null;
  shouldTransferPending: boolean;
}

interface ReducerOptions {
  failureFallbackMessage: string;
  now?: () => Date;
}

function hasPersistedAckMetadata(
  snapshot: Pick<SnapshotForOptimisticAssistant, 'persistedMessageId' | 'persistedRevision'>,
): boolean {
  return Boolean(snapshot.persistedMessageId)
    || snapshot.persistedRevision != null;
}

function hasRenderableSnapshotContent(
  snapshot: SnapshotForOptimisticAssistant,
  terminalContent: string,
): boolean {
  return Boolean(
    terminalContent
    || snapshot.streamingContent
    || snapshot.streamingReasoning
    || snapshot.toolUses.length > 0
    || snapshot.toolResults.length > 0
    || snapshot.streamingBlocks.length > 0,
  );
}

function findAssistantIndexByClientMessageId(
  messages: Message[],
  clientMessageId: string,
): number {
  return messages.findIndex((message) => (
    message.role === 'assistant' && message.client_message_id === clientMessageId
  ));
}

export function upsertOptimisticAssistantMessage(
  messages: Message[],
  sessionId: string,
  clientMessageId: string,
): OptimisticAssistantMutationResult {
  const existingIndex = findAssistantIndexByClientMessageId(messages, clientMessageId);
  if (existingIndex >= 0) {
    return {
      messages,
      assistantId: messages[existingIndex]?.id ?? null,
      shouldTransferPending: false,
    };
  }

  const nextMessage = buildOptimisticAssistantMessage(sessionId, clientMessageId);
  return {
    messages: [...messages, nextMessage],
    assistantId: nextMessage.id,
    shouldTransferPending: false,
  };
}

export function syncOptimisticAssistantFromSnapshot(
  messages: Message[],
  sessionId: string,
  snapshot: SnapshotForOptimisticAssistant,
  options: ReducerOptions,
): OptimisticAssistantMutationResult {
  if (!snapshot.clientMessageId) {
    return {
      messages,
      assistantId: null,
      shouldTransferPending: false,
    };
  }

  const terminalContent = snapshot.phase === 'active'
    ? ''
    : buildTerminalAssistantContent(snapshot, options.failureFallbackMessage);
  const existingIndex = findAssistantIndexByClientMessageId(messages, snapshot.clientMessageId);

  if (snapshot.phase !== 'active' && !hasRenderableSnapshotContent(snapshot, terminalContent)) {
    if (existingIndex >= 0 && hasPersistedAckMetadata(snapshot)) {
      const existingMessage = messages[existingIndex]!;
      const nextMessages = [...messages];
      nextMessages[existingIndex] = {
        ...existingMessage,
        client_message_id: snapshot.clientMessageId,
        db_message_id: snapshot.persistedMessageId ?? existingMessage.db_message_id ?? null,
        persisted_revision: snapshot.persistedRevision ?? existingMessage.persisted_revision ?? null,
      };

      return {
        messages: nextMessages,
        assistantId: existingMessage.id,
        shouldTransferPending: false,
      };
    }

    return {
      messages,
      assistantId: null,
      shouldTransferPending: false,
    };
  }

  if (existingIndex >= 0) {
    const existingMessage = messages[existingIndex]!;
    const nextMessage = {
      ...applySnapshotToOptimisticAssistantMessage(existingMessage, snapshot),
      ...(snapshot.phase === 'active' ? {} : { content: terminalContent }),
    };
    const nextMessages = [...messages];
    nextMessages[existingIndex] = nextMessage;
    return {
      messages: nextMessages,
      assistantId: existingMessage.id,
      shouldTransferPending: false,
    };
  }

  const optimisticMessage = buildOptimisticAssistantMessage(sessionId, snapshot.clientMessageId);
  const nextMessage = {
    ...applySnapshotToOptimisticAssistantMessage(optimisticMessage, snapshot),
    ...(snapshot.phase === 'active' ? {} : { content: terminalContent }),
  };

  return {
    messages: [...messages, nextMessage],
    assistantId: nextMessage.id,
    shouldTransferPending: false,
  };
}

export function finalizeOptimisticAssistantFromSnapshot(
  messages: Message[],
  sessionId: string,
  snapshot: SnapshotForOptimisticAssistant,
  options: ReducerOptions,
): OptimisticAssistantMutationResult {
  const terminalContent = buildTerminalAssistantContent(snapshot, options.failureFallbackMessage);
  const now = options.now ?? (() => new Date());

  if (snapshot.clientMessageId) {
    const existingIndex = findAssistantIndexByClientMessageId(messages, snapshot.clientMessageId);
    const existingAssistant = existingIndex >= 0 ? messages[existingIndex]! : null;
    const synced = syncOptimisticAssistantFromSnapshot(messages, sessionId, snapshot, options);

    if (!synced.assistantId) {
      if (
        existingAssistant
        && !existingAssistant.content.trim()
        && !existingAssistant.token_usage
      ) {
        return {
          messages: messages.filter((message) => message.id !== existingAssistant.id),
          assistantId: existingAssistant.id,
          shouldTransferPending: false,
        };
      }

      return {
        messages,
        assistantId: existingAssistant?.id ?? null,
        shouldTransferPending: false,
      };
    }

    return {
      ...synced,
      shouldTransferPending: Boolean(terminalContent),
    };
  }

  if (!terminalContent) {
    return {
      messages,
      assistantId: null,
      shouldTransferPending: false,
    };
  }

  const hasContentMatch = messages.some((message) => (
    message.role === 'assistant' && message.content === terminalContent
  ));
  if (hasContentMatch) {
    return {
      messages,
      assistantId: null,
      shouldTransferPending: false,
    };
  }

  const createdAt = now();
  const nextMessage: Message = {
    id: `temp-assistant-${createdAt.getTime()}`,
    session_id: sessionId,
    role: 'assistant',
    content: terminalContent,
    created_at: createdAt.toISOString(),
    token_usage: snapshot.tokenUsage ? JSON.stringify(snapshot.tokenUsage) : null,
    client_message_id: null,
  };

  return {
    messages: [...messages, nextMessage],
    assistantId: nextMessage.id,
    shouldTransferPending: true,
  };
}
