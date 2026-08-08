import { create } from 'zustand';
import {
  parseMessageContent,
  type AssistantRuntime,
  type Message,
  type MessageContentBlock,
  type SessionStreamSnapshot,
} from '@/types';
import { selectChatTimelineSession } from '@/lib/chat/selectors';
import {
  clearCachedChatSessionView,
  removeSessionMetaCacheEntry,
  setCachedChatSessionView,
} from '@/lib/session-client-cache';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { getChatRolloutMode, usesLegacyReconciliationFallback } from '@/lib/chat-rollout';
import { reconcileMessagesWithOptimistic } from '@/lib/chat-message-reconciliation';

// ==========================================
// Types
// ==========================================

export interface ChatSessionViewSlice {
  // Session metadata
  sessionTitle: string;
  sessionModel: string;
  sessionProviderId: string;
  sessionMode: string;
  sessionAssistantRuntime: AssistantRuntime | '';
  sessionRuntimeStatus: string;
  sessionRuntimeUpdatedAt: string;
  sessionType: 'chat' | 'terminal';
  projectName: string;
  sessionWorkingDir: string;

  // Data loading state
  loading: boolean;
  error: string | null;
  sessionResolved: boolean;

  // Messages
  messages: Message[];
  hasMore: boolean;
}

export const EMPTY_SESSION_VIEW: ChatSessionViewSlice = Object.freeze({
  sessionTitle: '',
  sessionModel: '',
  sessionProviderId: '',
  sessionMode: '',
  sessionAssistantRuntime: '',
  sessionRuntimeStatus: '',
  sessionRuntimeUpdatedAt: '',
  sessionType: 'chat' as const,
  projectName: '',
  sessionWorkingDir: '',
  loading: true,
  error: null,
  sessionResolved: false,
  messages: [] as Message[],
  hasMore: false,
});

// ==========================================
// Store interface
// ==========================================

interface ChatSessionViewStoreState {
  sessions: Record<string, ChatSessionViewSlice>;

  // Session-level operations
  hydrateSession: (sessionId: string, data: Partial<ChatSessionViewSlice>) => void;
  updateSessionMeta: (sessionId: string, meta: Partial<ChatSessionViewSlice>) => void;
  evictSession: (sessionId: string) => void;
  markSessionMissing: (sessionId: string, error?: string) => void;

  // Message operations
  syncMessagesFromTimeline: (sessionId: string, options?: { persistCache?: boolean }) => void;
  setMessages: (sessionId: string, messages: Message[], hasMore: boolean) => void;
  mergeMessagesFromServer: (sessionId: string, serverMessages: Message[], hasMore: boolean) => boolean;
  appendMessage: (sessionId: string, message: Message) => void;
  ackPersistedUser: (sessionId: string, clientMessageId: string, messageId: string, createdAt: string) => void;
  upsertOptimisticAssistant: (sessionId: string, clientMessageId: string) => string;
  syncOptimisticAssistantFromSnapshot: (
    sessionId: string,
    snapshot: Pick<
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
    >,
    failureFallbackMessage: string,
  ) => { assistantId: string | null; shouldTransferPending: boolean };
  finalizeOptimisticAssistantFromSnapshot: (
    sessionId: string,
    snapshot: Pick<
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
    >,
    failureFallbackMessage: string,
  ) => { assistantId: string | null; shouldTransferPending: boolean };
  updateMessage: (sessionId: string, messageId: string, updater: (message: Message) => Message) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  prependMessages: (sessionId: string, older: Message[], hasMore: boolean) => void;
  clearMessages: (sessionId: string) => void;

  // Loading state
  setLoading: (sessionId: string, loading: boolean) => void;
  setError: (sessionId: string, error: string | null) => void;
  setSessionResolved: (sessionId: string, resolved: boolean) => void;
}

function isTemporaryMessageId(messageId: string): boolean {
  return messageId.startsWith('temp-');
}

function normalizeMessageId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function getPersistedMessageId(message: Pick<Message, 'id' | 'db_message_id'>): string | null {
  const explicitMessageId = normalizeMessageId(message.db_message_id);
  if (explicitMessageId) {
    return explicitMessageId;
  }
  if (isTemporaryMessageId(message.id)) {
    return null;
  }
  return normalizeMessageId(message.id);
}

function buildClientMatchKey(message: Pick<Message, 'role' | 'client_message_id'>): string | null {
  const clientMessageId = normalizeMessageId(message.client_message_id);
  if (!clientMessageId) {
    return null;
  }
  return `${message.role}:${clientMessageId}`;
}

function buildDbMatchKey(message: Pick<Message, 'role' | 'id' | 'db_message_id'>): string | null {
  const persistedMessageId = getPersistedMessageId(message);
  if (!persistedMessageId) {
    return null;
  }
  return `${message.role}:${persistedMessageId}`;
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

function getTrailingLocalCarryoverMessages(messages: Message[]): Message[] {
  let startIndex = messages.length;
  while (startIndex > 0) {
    const message = messages[startIndex - 1];
    if (!message || !isLocalCarryoverMessage(message)) {
      break;
    }
    startIndex -= 1;
  }
  return messages.slice(startIndex);
}

function takeFirstUnmatched(
  candidates: Message[] | undefined,
  matchedMessageIds: Set<string>,
  consumeIndices: Map<string, number>,
  key: string,
): Message | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  let index = consumeIndices.get(key) ?? 0;
  while (index < candidates.length) {
    const next = candidates[index];
    index += 1;
    if (next && !matchedMessageIds.has(next.id)) {
      consumeIndices.set(key, index);
      return next;
    }
  }

  consumeIndices.set(key, index);
  return null;
}

function hasRenderableContent(content: string): boolean {
  return content.trim().length > 0;
}

function parseMessageCreatedAt(value: string | null | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
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

function normalizeContentForFingerprint(content: string): string {
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
  return `${message.role}:${normalizeContentForFingerprint(message.content)}`;
}

function consumeMatch(map: Map<string, number>, key: string): boolean {
  const current = map.get(key) ?? 0;
  if (current <= 0) {
    return false;
  }
  map.set(key, current - 1);
  return true;
}

function mergePersistedServerMessageOntoLocalShell(localMessage: Message, serverMessage: Message): Message {
  const persistedMessageId = getPersistedMessageId(serverMessage) ?? serverMessage.id;
  const shouldKeepLocalId = localMessage.role === 'assistant';
  return {
    ...serverMessage,
    id: shouldKeepLocalId ? localMessage.id : persistedMessageId,
    content: localMessage.role === 'assistant'
      && serverMessage.role === 'assistant'
      && hasRenderableContent(localMessage.content)
      ? localMessage.content
      : serverMessage.content,
    token_usage: serverMessage.token_usage ?? localMessage.token_usage,
    client_message_id: serverMessage.client_message_id ?? localMessage.client_message_id ?? null,
    db_message_id: persistedMessageId,
    persisted_revision: serverMessage.persisted_revision ?? localMessage.persisted_revision ?? null,
  };
}

function reinsertUnmatchedCarryoversInLocalOrder(
  mergedServerMessages: Message[],
  localCarryovers: Message[],
  unmatchedCarryovers: Message[],
  localToMergedMessageId: Map<string, string>,
): Message[] {
  if (unmatchedCarryovers.length === 0) {
    return mergedServerMessages;
  }

  const mergedMessageIds = new Set(mergedServerMessages.map((message) => message.id));
  const unmatchedCarryoverIds = new Set(unmatchedCarryovers.map((message) => message.id));
  const pendingBefore = new Map<string, Message[]>();
  const trailing: Message[] = [];

  for (let index = 0; index < localCarryovers.length; index += 1) {
    const message = localCarryovers[index];
    if (!message || !unmatchedCarryoverIds.has(message.id)) {
      continue;
    }

    let anchorId: string | null = null;
    for (let nextIndex = index + 1; nextIndex < localCarryovers.length; nextIndex += 1) {
      const nextMessage = localCarryovers[nextIndex];
      if (!nextMessage) {
        continue;
      }
      const candidateAnchorId = localToMergedMessageId.get(nextMessage.id) ?? null;
      if (candidateAnchorId && mergedMessageIds.has(candidateAnchorId)) {
        anchorId = candidateAnchorId;
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

  const merged: Message[] = [];
  for (const message of mergedServerMessages) {
    const pending = pendingBefore.get(message.id);
    if (pending && pending.length > 0) {
      merged.push(...pending);
    }
    merged.push(message);
  }

  if (trailing.length > 0) {
    merged.push(...trailing);
  }

  return merged;
}

function mergeBridgeMessagesFromServer(currentMessages: Message[], serverMessages: Message[]): Message[] {
  if (serverMessages.length === 0) {
    return currentMessages;
  }

  const localCarryovers = getTrailingLocalCarryoverMessages(currentMessages);
  if (localCarryovers.length === 0) {
    return serverMessages;
  }

  const localByClientKey = new Map<string, Message[]>();
  const localByDbKey = new Map<string, Message[]>();
  for (const message of localCarryovers) {
    const clientKey = buildClientMatchKey(message);
    if (clientKey) {
      const existing = localByClientKey.get(clientKey) ?? [];
      existing.push(message);
      localByClientKey.set(clientKey, existing);
    }

    const dbKey = buildDbMatchKey(message);
    if (dbKey) {
      const existing = localByDbKey.get(dbKey) ?? [];
      existing.push(message);
      localByDbKey.set(dbKey, existing);
    }
  }

  const matchedLocalMessageIds = new Set<string>();
  const consumeIndices = new Map<string, number>();
  const localToMergedMessageId = new Map<string, string>();
  const mergedServerMessages = serverMessages.map((serverMessage) => {
    const clientKey = buildClientMatchKey(serverMessage);
    const dbKey = buildDbMatchKey(serverMessage);

    let localMatch = takeFirstUnmatched(
      clientKey ? localByClientKey.get(clientKey) : undefined,
      matchedLocalMessageIds,
      consumeIndices,
      `cid:${clientKey ?? ''}`,
    );
    if (!localMatch) {
      localMatch = takeFirstUnmatched(
        dbKey ? localByDbKey.get(dbKey) : undefined,
        matchedLocalMessageIds,
        consumeIndices,
        `dbid:${dbKey ?? ''}`,
      );
    }

    if (!localMatch) {
      return serverMessage;
    }

    matchedLocalMessageIds.add(localMatch.id);
    if (!isTemporaryMessageId(localMatch.id)) {
      localToMergedMessageId.set(localMatch.id, serverMessage.id);
      return serverMessage;
    }

    const mergedMessage = mergePersistedServerMessageOntoLocalShell(localMatch, serverMessage);
    localToMergedMessageId.set(localMatch.id, mergedMessage.id);
    return mergedMessage;
  });

  const mergedIds = new Set(mergedServerMessages.map((message) => message.id));
  const mergedClientKeys = new Set(
    mergedServerMessages
      .map((message) => buildClientMatchKey(message))
      .filter((value): value is string => Boolean(value)),
  );
  const mergedDbKeys = new Set(
    mergedServerMessages
      .map((message) => buildDbMatchKey(message))
      .filter((value): value is string => Boolean(value)),
  );
  const serverFingerprints = new Map<string, number>();
  const serverFingerprintsWithoutClientId = new Map<string, number>();
  const latestServerTimestamp = serverMessages.reduce<number | null>((latest, message) => {
    const ts = parseMessageCreatedAt(message.created_at);
    if (ts === null) {
      return latest;
    }
    if (latest === null) {
      return ts;
    }
    return ts > latest ? ts : latest;
  }, null);
  for (const serverMessage of mergedServerMessages) {
    const fingerprint = buildMessageFingerprint(serverMessage);
    serverFingerprints.set(fingerprint, (serverFingerprints.get(fingerprint) ?? 0) + 1);
    if (!buildClientMatchKey(serverMessage)) {
      serverFingerprintsWithoutClientId.set(
        fingerprint,
        (serverFingerprintsWithoutClientId.get(fingerprint) ?? 0) + 1,
      );
    }
  }
  const unmatchedCarryovers: Message[] = [];

  for (const message of localCarryovers) {
    if (matchedLocalMessageIds.has(message.id) || mergedIds.has(message.id)) {
      continue;
    }

    const clientKey = buildClientMatchKey(message);
    if (clientKey && mergedClientKeys.has(clientKey)) {
      continue;
    }

    const dbKey = buildDbMatchKey(message);
    if (dbKey && mergedDbKeys.has(dbKey)) {
      continue;
    }

    if (message.role === 'assistant' && isTemporaryMessageId(message.id) && !clientKey && !dbKey) {
      const messageTimestamp = parseMessageCreatedAt(message.created_at);
      const hasNewerServerMessages = (
        latestServerTimestamp !== null
        && messageTimestamp !== null
        && latestServerTimestamp > messageTimestamp
      );
      if (hasNewerServerMessages) {
        continue;
      }
    }

    const fingerprint = buildMessageFingerprint(message);
    const matchFromServerWithoutClientId = consumeMatch(serverFingerprintsWithoutClientId, fingerprint);
    if (matchFromServerWithoutClientId) {
      consumeMatch(serverFingerprints, fingerprint);
      continue;
    }
    if (!clientKey && !dbKey && consumeMatch(serverFingerprints, fingerprint)) {
      continue;
    }

    unmatchedCarryovers.push(message);
  }

  if (unmatchedCarryovers.length === 0) {
    return mergedServerMessages;
  }

  return reinsertUnmatchedCarryoversInLocalOrder(
    mergedServerMessages,
    localCarryovers,
    unmatchedCarryovers,
    localToMergedMessageId,
  );
}

// ==========================================
// Store
// ==========================================

export const useChatSessionViewStore = create<ChatSessionViewStoreState>((set) => {
  const syncTimelineMessages = (sessionId: string, messages: Message[]) => {
    useChatTimelineStore.getState().replaceMessages(sessionId, messages);
  };

  const readTimelineSession = (sessionId: string) => (
    selectChatTimelineSession(useChatTimelineStore.getState(), sessionId)
  );

  const readTimelineMessages = (sessionId: string) => readTimelineSession(sessionId).messages;

  /** Immutable update helper for a single session slice */
  const updateSlice = (
    sessionId: string,
    updater: (current: ChatSessionViewSlice) => Partial<ChatSessionViewSlice>,
    options: { syncTimeline?: boolean; persistCache?: boolean } = {},
  ) => {
    const shouldSyncTimeline = options.syncTimeline ?? true;
    const shouldPersistCache = options.persistCache ?? true;
    let nextMessages: Message[] | null = null;
    let cachedSlice: ChatSessionViewSlice | undefined;

    set((state) => {
      const current = state.sessions[sessionId] ?? { ...EMPTY_SESSION_VIEW };
      const patch = updater(current);
      if (Object.prototype.hasOwnProperty.call(patch, 'messages')) {
        nextMessages = patch.messages ?? [];
      }
      const nextSlice: ChatSessionViewSlice = { ...current, ...patch };
      cachedSlice = nextSlice;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: nextSlice,
        },
      };
    });

    if (shouldSyncTimeline && nextMessages !== null) {
      syncTimelineMessages(sessionId, nextMessages);
    }

    if (!shouldPersistCache) {
      return;
    }

    if (cachedSlice?.sessionType === 'chat') {
      setCachedChatSessionView({
        sessionId,
        messages: cachedSlice.messages,
        hasMore: cachedSlice.hasMore,
        sessionTitle: cachedSlice.sessionTitle,
        sessionModel: cachedSlice.sessionModel,
        sessionProviderId: cachedSlice.sessionProviderId,
        sessionMode: cachedSlice.sessionMode,
        sessionAssistantRuntime: cachedSlice.sessionAssistantRuntime,
        sessionType: cachedSlice.sessionType,
        projectName: cachedSlice.projectName,
        sessionWorkingDir: cachedSlice.sessionWorkingDir,
      });
    } else if (cachedSlice) {
      clearCachedChatSessionView(sessionId);
    }
  };

  return {
    sessions: {},

    hydrateSession: (sessionId, data) => {
      updateSlice(sessionId, () => data);
    },

    updateSessionMeta: (sessionId, meta) => {
      updateSlice(sessionId, () => meta);
    },

    evictSession: (sessionId) => {
      set((state) => {
        const next = { ...state.sessions };
        delete next[sessionId];
        return { sessions: next };
      });
      useChatTimelineStore.getState().evictSession(sessionId);
      clearCachedChatSessionView(sessionId);
    },

    markSessionMissing: (sessionId, error = 'Session not found') => {
      useChatTimelineStore.getState().evictSession(sessionId);
      clearCachedChatSessionView(sessionId);
      removeSessionMetaCacheEntry(sessionId);

      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...EMPTY_SESSION_VIEW,
            loading: false,
            error,
            sessionResolved: true,
          },
        },
      }));
    },

    syncMessagesFromTimeline: (sessionId, options) => {
      updateSlice(sessionId, () => ({
        messages: readTimelineMessages(sessionId),
      }), {
        syncTimeline: false,
        persistCache: options?.persistCache ?? false,
      });
    },

    setMessages: (sessionId, messages, hasMore) => {
      syncTimelineMessages(sessionId, messages);
      updateSlice(sessionId, () => ({
        messages: readTimelineMessages(sessionId),
        hasMore,
        loading: false,
      }), { syncTimeline: false });
    },

    mergeMessagesFromServer: (sessionId, serverMessages, hasMore) => {
      const timelineStore = useChatTimelineStore.getState();
      const rolloutMode = getChatRolloutMode();
      const beforeMerge = readTimelineSession(sessionId);
      const beforeMergeMessages = beforeMerge.messages;
      let stillHasOptimistic: boolean;

      if (usesLegacyReconciliationFallback(rolloutMode)) {
        const mergedMessages = reconcileMessagesWithOptimistic(beforeMergeMessages, serverMessages);
        timelineStore.replaceMessages(sessionId, mergedMessages);
        stillHasOptimistic = readTimelineSession(sessionId).hasOptimisticMessages;
      } else if (rolloutMode === 'bridge') {
        const mergedMessages = mergeBridgeMessagesFromServer(beforeMergeMessages, serverMessages);
        timelineStore.replaceMessages(sessionId, mergedMessages);
        stillHasOptimistic = readTimelineSession(sessionId).hasOptimisticMessages;
      } else {
        stillHasOptimistic = timelineStore.mergeMessagesFromServer(sessionId, serverMessages);
      }

      updateSlice(sessionId, () => ({
        messages: readTimelineMessages(sessionId),
        hasMore,
        loading: false,
      }), { syncTimeline: false });
      return stillHasOptimistic;
    },

    appendMessage: (sessionId, message) => {
      useChatTimelineStore.getState().appendMessage(sessionId, message);
    },

    ackPersistedUser: (sessionId, clientMessageId, messageId, createdAt) => {
      useChatTimelineStore.getState().ackPersistedUser(sessionId, clientMessageId, messageId, createdAt);
    },

    upsertOptimisticAssistant: (sessionId, clientMessageId) => {
      const assistantId = useChatTimelineStore
        .getState()
        .upsertOptimisticAssistant(sessionId, clientMessageId);
      return assistantId;
    },

    syncOptimisticAssistantFromSnapshot: (sessionId, snapshot, failureFallbackMessage) => {
      const result = useChatTimelineStore
        .getState()
        .syncOptimisticAssistantFromSnapshot(sessionId, snapshot, failureFallbackMessage);
      return {
        assistantId: result.assistantId ?? null,
        shouldTransferPending: result.shouldTransferPending ?? false,
      };
    },

    finalizeOptimisticAssistantFromSnapshot: (sessionId, snapshot, failureFallbackMessage) => {
      const result = useChatTimelineStore
        .getState()
        .finalizeOptimisticAssistantFromSnapshot(sessionId, snapshot, failureFallbackMessage);
      return {
        assistantId: result.assistantId ?? null,
        shouldTransferPending: result.shouldTransferPending ?? false,
      };
    },

    updateMessage: (sessionId, messageId, updater) => {
      useChatTimelineStore.getState().updateMessage(sessionId, messageId, updater);
    },

    removeMessage: (sessionId, messageId) => {
      useChatTimelineStore.getState().removeMessage(sessionId, messageId);
    },

    prependMessages: (sessionId, older, hasMore) => {
      useChatTimelineStore.getState().prependMessages(sessionId, older);
      updateSlice(sessionId, () => ({
        messages: readTimelineMessages(sessionId),
        hasMore,
      }), { syncTimeline: false });
    },

    clearMessages: (sessionId) => {
      useChatTimelineStore.getState().clearMessages(sessionId);
      updateSlice(sessionId, () => ({
        messages: readTimelineMessages(sessionId),
        hasMore: false,
      }), { syncTimeline: false });
    },

    setLoading: (sessionId, loading) => {
      updateSlice(sessionId, () => ({ loading }), { persistCache: false });
    },

    setError: (sessionId, error) => {
      updateSlice(sessionId, () => ({ error, loading: false }), { persistCache: false });
    },

    setSessionResolved: (sessionId, resolved) => {
      updateSlice(sessionId, () => ({ sessionResolved: resolved }), { persistCache: false });
    },
  };
});
