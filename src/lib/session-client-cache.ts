import type { AssistantRuntime } from '@/types';
import type { Message } from '@/types';

export interface SessionMetaCacheEntry {
  sessionId: string;
  title: string;
  workingDirectory: string;
  sessionType: 'chat' | 'terminal';
  updatedAt: number;
}

export interface ChatSessionViewCacheEntry {
  sessionId: string;
  messages: Message[];
  hasMore: boolean;
  sessionTitle: string;
  sessionModel: string;
  sessionProviderId: string;
  sessionMode: string;
  sessionAssistantRuntime: AssistantRuntime | '';
  sessionType: 'chat' | 'terminal';
  projectName: string;
  sessionWorkingDir: string;
  loadedFromServer?: boolean;
  updatedAt: number;
}

const OBSOLETE_CONVERSATION_STORAGE_KEYS = [
  'noonflow:session-meta-cache',
  'monolith:session-meta-cache',
  'noonflow:chat-view-cache',
  'monolith:chat-view-cache',
  'noonflow:split-sessions',
  'monolith:split-sessions',
  'noonflow:split-active-column',
  'monolith:split-active-column',
  'noonflow-session-store',
  'monolith-session-store',
  'noonflow:permission-memory',
  'monolith:permission-memory',
  'noonflow:workspace-folders',
  'monolith:workspace-folders',
  'revertedAssistantMessages',
  'imgref:last_generated',
] as const;
const OBSOLETE_CONVERSATION_STORAGE_PREFIXES = [
  'noonflow:open-tabs:',
  'monolith:open-tabs:',
  'noonflow:tabs-scroll:',
  'monolith:tabs-scroll:',
  'noonflow:terminal-panel:',
  'monolith:terminal-panel:',
  'noonflow:replay-return-to:',
  'imggen:',
] as const;
const SESSION_META_CACHE_KEY = '__noonflowSessionMetaCache__' as const;
const CHAT_VIEW_CACHE_KEY = '__noonflowChatSessionViewCache__' as const;
const STORAGE_PURGED_KEY = '__noonflowConversationStoragePurged__' as const;

export function purgeObsoleteConversationStorage(): void {
  if (typeof window === 'undefined') return;
  const globalObject = globalThis as Record<string, unknown>;
  if (globalObject[STORAGE_PURGED_KEY]) return;
  globalObject[STORAGE_PURGED_KEY] = true;

  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of OBSOLETE_CONVERSATION_STORAGE_KEYS) {
        storage.removeItem(key);
      }
      const prefixedKeys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && OBSOLETE_CONVERSATION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          prefixedKeys.push(key);
        }
      }
      for (const key of prefixedKeys) storage.removeItem(key);
    } catch {
      // Best effort for browsers that deny storage access.
    }
  }
}

function getSessionMetaCacheMap(): Map<string, SessionMetaCacheEntry> {
  purgeObsoleteConversationStorage();
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[SESSION_META_CACHE_KEY]) {
    globalObject[SESSION_META_CACHE_KEY] = new Map<string, SessionMetaCacheEntry>();
  }
  return globalObject[SESSION_META_CACHE_KEY] as Map<string, SessionMetaCacheEntry>;
}

export function getSessionMetaCacheSnapshot(): Record<string, SessionMetaCacheEntry> {
  return Object.fromEntries(getSessionMetaCacheMap().entries());
}

export function getSessionMetaCacheEntry(sessionId: string): SessionMetaCacheEntry | null {
  if (!sessionId) {
    return null;
  }
  return getSessionMetaCacheMap().get(sessionId) ?? null;
}

export function upsertSessionMetaCacheEntry(entry: Omit<SessionMetaCacheEntry, 'updatedAt'>): Record<string, SessionMetaCacheEntry> {
  if (!entry.sessionId) {
    return getSessionMetaCacheSnapshot();
  }

  const cache = getSessionMetaCacheMap();
  cache.set(entry.sessionId, {
    ...cache.get(entry.sessionId),
    ...entry,
    updatedAt: Date.now(),
  });
  return getSessionMetaCacheSnapshot();
}

export function upsertSessionMetaCacheEntries(
  entries: Array<Omit<SessionMetaCacheEntry, 'updatedAt'>>,
): Record<string, SessionMetaCacheEntry> {
  const cache = getSessionMetaCacheMap();
  for (const entry of entries) {
    if (!entry.sessionId) {
      continue;
    }
    cache.set(entry.sessionId, {
      ...cache.get(entry.sessionId),
      ...entry,
      updatedAt: Date.now(),
    });
  }
  return getSessionMetaCacheSnapshot();
}

export function removeSessionMetaCacheEntry(sessionId: string): Record<string, SessionMetaCacheEntry> {
  getSessionMetaCacheMap().delete(sessionId);
  return getSessionMetaCacheSnapshot();
}

function getChatViewCacheMap(): Map<string, ChatSessionViewCacheEntry> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[CHAT_VIEW_CACHE_KEY]) {
    purgeObsoleteConversationStorage();
    globalObject[CHAT_VIEW_CACHE_KEY] = new Map<string, ChatSessionViewCacheEntry>();
  }
  return globalObject[CHAT_VIEW_CACHE_KEY] as Map<string, ChatSessionViewCacheEntry>;
}

export function getCachedChatSessionView(sessionId: string): ChatSessionViewCacheEntry | null {
  return getChatViewCacheMap().get(sessionId) ?? null;
}

export function setCachedChatSessionView(
  entry: Omit<ChatSessionViewCacheEntry, 'updatedAt'>,
): ChatSessionViewCacheEntry | null {
  if (!entry.sessionId) {
    return null;
  }

  const nextEntry: ChatSessionViewCacheEntry = {
    ...entry,
    updatedAt: Date.now(),
  };
  const map = getChatViewCacheMap();
  map.set(entry.sessionId, nextEntry);
  return nextEntry;
}

export function isTrustedChatSessionViewCache(entry: ChatSessionViewCacheEntry | null | undefined): boolean {
  if (!entry) {
    return false;
  }

  if (entry.loadedFromServer) {
    return true;
  }

  return entry.messages.length > 0;
}

export function isResolvedChatSessionCache(
  entry: ChatSessionViewCacheEntry | null | undefined,
  sessionType: 'chat' | 'terminal',
): boolean {
  if (sessionType !== 'chat') {
    return true;
  }

  return Boolean(entry?.sessionAssistantRuntime);
}

export function clearCachedChatSessionView(sessionId: string): void {
  getChatViewCacheMap().delete(sessionId);
}
