import { updateMessageRecord, upsertAssistantMessage, upsertMessageParts } from '@/lib/db';
import { buildMessagePartInputs, serializeMessageContentBlocks } from '@/lib/message-content';
import type {
  AssistantPersistedEventData,
  MessageContentBlock,
  TokenUsage,
} from '@/types';

interface PersistAssistantTerminalStateDirectOptions {
  sessionId: string;
  messageId: string;
  clientMessageId: string;
  blocks: MessageContentBlock[];
  tokenUsage?: TokenUsage | null;
  terminalStatus: 'completed' | 'error';
  revision: number;
}

export function persistAssistantTerminalStateDirect(
  options: PersistAssistantTerminalStateDirectOptions,
): AssistantPersistedEventData {
  const {
    sessionId,
    messageId,
    clientMessageId,
    blocks,
    tokenUsage,
    terminalStatus,
    revision,
  } = options;

  const content = serializeMessageContentBlocks(blocks);
  const tokenUsagePayload = tokenUsage ? JSON.stringify(tokenUsage) : null;
  const completedAt = new Date().toISOString().replace('T', ' ').split('.')[0];

  upsertAssistantMessage(sessionId, clientMessageId, content, tokenUsagePayload);
  upsertMessageParts(
    messageId,
    sessionId,
    buildMessagePartInputs(blocks, {
      includeStableKeys: true,
      revision,
      isFinal: true,
      updatedAt: Date.now(),
    }),
    { pruneMissingPartKeys: true },
  );
  const persistedMessage = updateMessageRecord(messageId, content, {
    tokenUsage: tokenUsagePayload,
    status: terminalStatus,
    contentFormatVersion: 2,
    completedAt,
    persistedRevision: revision,
  });

  return {
    session_id: sessionId,
    client_message_id: clientMessageId,
    message_id: persistedMessage.id,
    revision,
    created_at: persistedMessage.created_at,
  };
}
