import type { Message } from '@/types';

export function buildConversationHistoryForPrompt(
  recentMsgs: Message[],
  currentUserMessageId: string,
  clientMessageId?: string | null,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const normalizedClientMessageId = typeof clientMessageId === 'string' && clientMessageId.trim().length > 0
    ? clientMessageId.trim()
    : null;
  const historySource = normalizedClientMessageId
    ? recentMsgs.filter((message) => (
      message.id !== currentUserMessageId
      && message.client_message_id !== normalizedClientMessageId
    ))
    : recentMsgs.filter((message) => message.id !== currentUserMessageId);

  return historySource.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }));
}
