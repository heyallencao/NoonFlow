import { parseMessageContent, type Message, type MessageContentBlock } from '@/types';
import { parseDBDate } from '@/lib/utils';

function isTemporaryMessageId(messageId: string): boolean {
  return messageId.startsWith('temp-');
}

function isLocallyPersistedUserMessage(
  message: Pick<Message, 'id' | 'role' | 'client_message_id' | 'db_message_id'>,
): boolean {
  return message.role === 'user'
    && !isTemporaryMessageId(message.id)
    && Boolean(getPersistedMessageId(message));
}

function isLocalCarryoverMessage(
  message: Pick<Message, 'id' | 'role' | 'client_message_id' | 'db_message_id'>,
): boolean {
  return isTemporaryMessageId(message.id) || isLocallyPersistedUserMessage(message);
}

function getTrailingLocalCarryoverMessages(currentMessages: Message[]): Message[] {
  let startIndex = currentMessages.length;
  while (startIndex > 0) {
    const message = currentMessages[startIndex - 1];
    if (!message || !isLocalCarryoverMessage(message)) {
      break;
    }
    startIndex -= 1;
  }

  return currentMessages.slice(startIndex);
}

function normalizeContent(content: string): string {
  const stripped = content.replace(/^<!--files:.*?-->\n?/, '');
  const blocks = parseMessageContent(stripped).filter((block) => {
    if (block.type === 'text' || block.type === 'reasoning') {
      return block.text.trim().length > 0;
    }
    return true;
  });
  return blocks.map(serializeContentBlockForFingerprint).join('\n').trim();
}

function buildMessageFingerprint(message: Pick<Message, 'role' | 'content'>): string {
  return `${message.role}:${normalizeContent(message.content)}`;
}

function serializeContentBlockForFingerprint(block: MessageContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return `${block.type}:${block.text.trim()}`;
    case 'tool_use':
      return `tool_use:${block.id}:${block.name}:${JSON.stringify(block.input ?? null)}`;
    case 'tool_result':
      return `tool_result:${block.tool_use_id}:${block.is_error === true ? 'error' : 'ok'}:${block.content}`;
    case 'code':
      return `code:${block.language}:${block.code}`;
    default:
      return JSON.stringify(block);
  }
}

function normalizeClientMessageId(clientMessageId: string | null | undefined): string | null {
  const normalized = clientMessageId?.trim();
  return normalized ? normalized : null;
}

function normalizeDbMessageId(dbMessageId: string | null | undefined): string | null {
  const normalized = dbMessageId?.trim();
  return normalized ? normalized : null;
}

function hasMeaningfulContent(content: string): boolean {
  return normalizeContent(content).trim().length > 0;
}

function getPersistedMessageId(message: Pick<Message, 'id' | 'db_message_id'>): string | null {
  const explicitDbMessageId = normalizeDbMessageId(message.db_message_id);
  if (explicitDbMessageId) {
    return explicitDbMessageId;
  }
  if (isTemporaryMessageId(message.id)) {
    return null;
  }
  return normalizeDbMessageId(message.id);
}

/** Consume index map tracks how far we've scanned in each candidate array. */
type ConsumeIndexMap = Map<string, number>;

function takeFirstUnmatched(
  candidates: Message[] | undefined,
  matchedMessageIds: Set<string>,
  consumeIndices: ConsumeIndexMap,
  key: string,
): Message | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  let idx = consumeIndices.get(key) ?? 0;
  while (idx < candidates.length) {
    const next = candidates[idx];
    idx++;
    if (next && !matchedMessageIds.has(next.id)) {
      consumeIndices.set(key, idx);
      return next;
    }
  }
  consumeIndices.set(key, idx);

  return null;
}

export function isOptimisticMessage(message: Pick<Message, 'id' | 'db_message_id'>): boolean {
  return isTemporaryMessageId(message.id) && !normalizeDbMessageId(message.db_message_id);
}

export function isTransientMessage(message: Pick<Message, 'id' | 'db_message_id' | 'client_message_id'>): boolean {
  // Transient messages are synthesized assistant messages for local stop/error states.
  return message.id.startsWith('temp-assistant-')
    && !normalizeDbMessageId(message.db_message_id)
    && !normalizeClientMessageId(message.client_message_id);
}

function parseTimestamp(value: string): number | null {
  const parsed = parseDBDate(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function hasServerAssistantAtOrAfter(serverMessages: Message[], timestampMs: number | null): boolean {
  if (timestampMs === null) {
    return false;
  }

  return serverMessages.some((message) => {
    if (message.role !== 'assistant') {
      return false;
    }
    const messageTs = parseTimestamp(message.created_at);
    return messageTs !== null && messageTs >= timestampMs;
  });
}

export function hasOptimisticMessages(messages: Message[]): boolean {
  return messages.some((message) => isOptimisticMessage(message));
}

function consumeMatch(map: Map<string, number>, key: string | null): boolean {
  if (!key) {
    return false;
  }

  const matchCount = map.get(key) ?? 0;
  if (matchCount <= 0) {
    return false;
  }

  map.set(key, matchCount - 1);
  return true;
}

function consumeFingerprintMatch(
  fingerprint: string,
  remainingServerMatches: Map<string, number>,
  remainingServerMatchesWithoutClientId: Map<string, number>,
  onlyWithoutClientId: boolean,
): boolean {
  const source = onlyWithoutClientId ? remainingServerMatchesWithoutClientId : remainingServerMatches;
  if (!consumeMatch(source, fingerprint)) {
    return false;
  }

  if (onlyWithoutClientId) {
    consumeMatch(remainingServerMatches, fingerprint);
  } else {
    consumeMatch(remainingServerMatchesWithoutClientId, fingerprint);
  }

  return true;
}

function mergePersistedMessage(
  optimisticMessage: Message,
  serverMessage: Message,
): Message {
  if (optimisticMessage.role !== 'assistant' || serverMessage.role !== 'assistant') {
    return serverMessage;
  }

  const persistedMessageId = getPersistedMessageId(serverMessage) ?? serverMessage.id;
  return {
    ...serverMessage,
    id: optimisticMessage.id,
    content: hasMeaningfulContent(optimisticMessage.content)
      ? optimisticMessage.content
      : serverMessage.content,
    token_usage: serverMessage.token_usage ?? optimisticMessage.token_usage,
    client_message_id: serverMessage.client_message_id ?? optimisticMessage.client_message_id ?? null,
    db_message_id: persistedMessageId,
  };
}

/**
 * Reinsert unmatched local messages into their original chronological position
 * relative to matched messages, instead of blindly appending them to the end.
 *
 * For each unmatched message, we find the next matched local message that comes
 * after it in the original local order, then insert the unmatched message before
 * that anchor in the merged result. If no anchor is found (i.e. no matched
 * message follows it), the unmatched message is appended at the end.
 */
function reinsertUnmatchedInLocalOrder(
  mergedServerMessages: Message[],
  localMessages: Message[],
  unmatchedMessages: Message[],
  matchedLocalMessageIds: Set<string>,
  localToMergedId: Map<string, string>,
): Message[] {
  if (unmatchedMessages.length === 0) {
    return mergedServerMessages;
  }

  const mergedMessageIds = new Set(mergedServerMessages.map((m) => m.id));
  const unmatchedMessageIds = new Set(unmatchedMessages.map((m) => m.id));

  // For each unmatched message, determine its insertion anchor: the first matched
  // message that comes after it in the original local order.
  const pendingBefore = new Map<string, Message[]>();
  const trailing: Message[] = [];

  for (let i = 0; i < localMessages.length; i++) {
    const message = localMessages[i];
    if (!message || !unmatchedMessageIds.has(message.id)) {
      continue;
    }

    // Walk forward from this position to find the next matched message
    let anchorId: string | null = null;
    for (let j = i + 1; j < localMessages.length; j++) {
      const candidate = localMessages[j];
      if (!candidate || !matchedLocalMessageIds.has(candidate.id)) continue;
      // Resolve the local ID to its merged ID (may differ for user messages
      // where mergePersistedMessage returns the server message directly)
      const mergedId = localToMergedId.get(candidate.id) ?? candidate.id;
      if (mergedMessageIds.has(mergedId)) {
        anchorId = mergedId;
        break;
      }
    }

    if (!anchorId) {
      trailing.push(message);
      continue;
    }

    const existing = pendingBefore.get(anchorId) ?? [];
    existing.push(message);
    pendingBefore.set(anchorId, existing);
  }

  // Rebuild the merged result, inserting unmatched messages before their anchors
  const result: Message[] = [];
  for (const message of mergedServerMessages) {
    const pending = pendingBefore.get(message.id);
    if (pending && pending.length > 0) {
      result.push(...pending);
    }
    result.push(message);
  }

  if (trailing.length > 0) {
    result.push(...trailing);
  }

  return result;
}

export function reconcileMessagesWithOptimistic(
  currentMessages: Message[],
  serverMessages: Message[],
): Message[] {
  const localMessages = getTrailingLocalCarryoverMessages(currentMessages);
  if (localMessages.length === 0) {
    return serverMessages;
  }
  if (serverMessages.length === 0) {
    return currentMessages;
  }

  const localMessagesByClientId = new Map<string, Message[]>();
  const localMessagesByDbId = new Map<string, Message[]>();
  for (const message of localMessages) {
    const clientMessageId = normalizeClientMessageId(message.client_message_id);
    if (clientMessageId) {
      const mapKey = `${message.role}:${clientMessageId}`;
      const messagesForClientId = localMessagesByClientId.get(mapKey) ?? [];
      messagesForClientId.push(message);
      localMessagesByClientId.set(mapKey, messagesForClientId);
    }

    const dbMessageId = getPersistedMessageId(message);
    if (dbMessageId) {
      const mapKey = `${message.role}:${dbMessageId}`;
      const messagesForDbId = localMessagesByDbId.get(mapKey) ?? [];
      messagesForDbId.push(message);
      localMessagesByDbId.set(mapKey, messagesForDbId);
    }
  }

  const remainingServerMatches = new Map<string, number>();
  const remainingServerMatchesWithoutClientId = new Map<string, number>();
  const matchedLocalMessageIds = new Set<string>();
  const localToMergedId = new Map<string, string>();
  const serverClientMessageIds = new Set(
    serverMessages
      .map((m) => normalizeClientMessageId(m.client_message_id))
      .filter((id): id is string => id !== null),
  );
  const consumeIndices: ConsumeIndexMap = new Map();
  const mergedServerMessages = serverMessages.map((message) => {
    const clientMessageId = normalizeClientMessageId(message.client_message_id);
    const dbMessageId = getPersistedMessageId(message);
    const fingerprint = buildMessageFingerprint(message);

    remainingServerMatches.set(fingerprint, (remainingServerMatches.get(fingerprint) ?? 0) + 1);
    if (!clientMessageId) {
      remainingServerMatchesWithoutClientId.set(
        fingerprint,
        (remainingServerMatchesWithoutClientId.get(fingerprint) ?? 0) + 1,
      );
    }

    let optimisticMessage = takeFirstUnmatched(
      clientMessageId ? localMessagesByClientId.get(`${message.role}:${clientMessageId}`) : undefined,
      matchedLocalMessageIds,
      consumeIndices,
      `cid:${message.role}:${clientMessageId}`,
    );
    if (!optimisticMessage) {
      optimisticMessage = takeFirstUnmatched(
        dbMessageId ? localMessagesByDbId.get(`${message.role}:${dbMessageId}`) : undefined,
        matchedLocalMessageIds,
        consumeIndices,
        `dbid:${message.role}:${dbMessageId}`,
      );
    }
    if (!optimisticMessage) {
      return message;
    }

    matchedLocalMessageIds.add(optimisticMessage.id);
    consumeMatch(remainingServerMatches, fingerprint);
    if (!clientMessageId) {
      consumeMatch(remainingServerMatchesWithoutClientId, fingerprint);
    }
    const merged = mergePersistedMessage(optimisticMessage, message);
    localToMergedId.set(optimisticMessage.id, merged.id);
    return merged;
  });

  const unmatchedOptimisticMessages: Message[] = [];
  for (const message of localMessages) {
    if (matchedLocalMessageIds.has(message.id)) {
      continue;
    }

    const clientMessageId = normalizeClientMessageId(message.client_message_id);
    const dbMessageId = getPersistedMessageId(message);

    if (isTransientMessage(message)) {
      // If the server has already persisted any assistant message for this
      // client_message_id, the transient local fallback is stale.
      if (clientMessageId && serverClientMessageIds.has(clientMessageId)) {
        continue;
      }

      // Keep transient stopped/error output visible until server has either
      // persisted that assistant message (same fingerprint) or produced a newer
      // assistant reply. This prevents "stop -> content disappears" regressions.
      const fingerprint = buildMessageFingerprint(message);
      const matchedByFingerprint = consumeFingerprintMatch(
        fingerprint,
        remainingServerMatches,
        remainingServerMatchesWithoutClientId,
        Boolean(clientMessageId || dbMessageId),
      );
      if (matchedByFingerprint) {
        continue;
      }

      const hasServerFingerprint = serverMessages.some((serverMessage) => (
        buildMessageFingerprint(serverMessage) === fingerprint
      ));
      if (hasServerFingerprint) {
        unmatchedOptimisticMessages.push(message);
        continue;
      }

      // Allow timestamp-based cleanup when:
      // 1. No clientMessageId (original behavior), OR
      // 2. clientMessageId exists but the server never persisted it (failed/stopped stream)
      const clientIdUnpersistedByServer = clientMessageId && !serverClientMessageIds.has(clientMessageId);
      // Keep cleanup enabled even when multiple transient messages share the same
      // fingerprint, otherwise repeated "SESSION_BUSY" failures can accumulate and
      // reappear after later successful turns.
      const canUseTimestampFallback = !clientMessageId || clientIdUnpersistedByServer;
      const transientTimestamp = parseTimestamp(message.created_at);
      const supersededByServerAssistant = canUseTimestampFallback
        ? hasServerAssistantAtOrAfter(mergedServerMessages, transientTimestamp)
        : false;
      if (!supersededByServerAssistant) {
        unmatchedOptimisticMessages.push(message);
      }
      continue;
    }

    const fingerprint = buildMessageFingerprint(message);
    const matchedByFingerprint = consumeFingerprintMatch(
      fingerprint,
      remainingServerMatches,
      remainingServerMatchesWithoutClientId,
      Boolean(clientMessageId || dbMessageId),
    );
    if (matchedByFingerprint) {
      continue;
    }
    unmatchedOptimisticMessages.push(message);
  }

  if (unmatchedOptimisticMessages.length === 0) {
    return mergedServerMessages;
  }

  return reinsertUnmatchedInLocalOrder(
    mergedServerMessages,
    localMessages,
    unmatchedOptimisticMessages,
    matchedLocalMessageIds,
    localToMergedId,
  );
}
