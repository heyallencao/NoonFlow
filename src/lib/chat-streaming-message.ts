import { buildAssistantMessageContent } from '@/lib/message-content';
import type { Message, SessionStreamSnapshot } from '@/types';

export function buildOptimisticAssistantMessageId(clientMessageId: string): string {
  return `temp-assistant-${clientMessageId}`;
}

export function buildOptimisticAssistantMessage(
  sessionId: string,
  clientMessageId: string,
  createdAt: string = new Date().toISOString(),
): Message {
  return {
    id: buildOptimisticAssistantMessageId(clientMessageId),
    session_id: sessionId,
    role: 'assistant',
    content: '',
    created_at: createdAt,
    token_usage: null,
    client_message_id: clientMessageId,
  };
}

export function buildSnapshotAssistantContent(snapshot: Pick<
  SessionStreamSnapshot,
  'streamingReasoning' | 'streamingContent' | 'toolUses' | 'toolResults' | 'streamingBlocks' | 'finalMessageContent'
>): string {
  const contentFromSnapshot = buildAssistantMessageContent({
    reasoning: snapshot.streamingReasoning,
    text: snapshot.streamingContent,
    toolUses: snapshot.toolUses,
    toolResults: snapshot.toolResults,
    streamingBlocks: snapshot.streamingBlocks,
  }) || '';

  if (contentFromSnapshot) {
    return contentFromSnapshot;
  }

  return snapshot.finalMessageContent || '';
}

export function buildTerminalAssistantContent(
  snapshot: Pick<
    SessionStreamSnapshot,
    | 'phase'
    | 'error'
    | 'streamingReasoning'
    | 'streamingContent'
    | 'toolUses'
    | 'toolResults'
    | 'streamingBlocks'
    | 'finalMessageContent'
  >,
  failureFallbackMessage: string,
): string {
  const content = buildSnapshotAssistantContent(snapshot);
  if (content) {
    return content;
  }

  if (snapshot.phase !== 'error') {
    return '';
  }

  return snapshot.error
    ? `${failureFallbackMessage}\n\n错误详情：${snapshot.error}`
    : failureFallbackMessage;
}

export function applySnapshotToOptimisticAssistantMessage(
  message: Message,
  snapshot: Pick<
    SessionStreamSnapshot,
    | 'clientMessageId'
    | 'streamingReasoning'
    | 'streamingContent'
    | 'toolUses'
    | 'toolResults'
    | 'streamingBlocks'
    | 'finalMessageContent'
    | 'tokenUsage'
    | 'persistedMessageId'
    | 'persistedRevision'
  >,
): Message {
  return {
    ...message,
    client_message_id: snapshot.clientMessageId,
    content: buildSnapshotAssistantContent(snapshot),
    token_usage: snapshot.tokenUsage ? JSON.stringify(snapshot.tokenUsage) : null,
    db_message_id: snapshot.persistedMessageId ?? message.db_message_id ?? null,
    persisted_revision: snapshot.persistedRevision ?? message.persisted_revision ?? null,
  };
}
