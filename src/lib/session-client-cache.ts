import type { AssistantRuntime } from '@/types';
import type { Message } from '@/types';
import {
  getLocalStorageSafe,
  getSessionStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

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

const SESSION_META_STORAGE_KEY = 'noonflow:session-meta-cache';
const LEGACY_SESSION_META_STORAGE_KEYS = ['monolith:session-meta-cache'] as const;
const CHAT_VIEW_STORAGE_KEY = 'noonflow:chat-view-cache';
const LEGACY_CHAT_VIEW_STORAGE_KEYS = ['monolith:chat-view-cache'] as const;
const CHAT_VIEW_CACHE_KEY = '__noonflowChatSessionViewCache__' as const;

function readSessionMetaCache(): Record<string, SessionMetaCacheEntry> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      SESSION_META_STORAGE_KEY,
      LEGACY_SESSION_META_STORAGE_KEYS,
    );
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, SessionMetaCacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionMetaCache(cache: Record<string, SessionMetaCacheEntry>): Record<string, SessionMetaCacheEntry> {
  if (typeof window !== 'undefined') {
    writeStorageValue(getLocalStorageSafe(), SESSION_META_STORAGE_KEY, JSON.stringify(cache));
  }
  return cache;
}

export function getSessionMetaCacheSnapshot(): Record<string, SessionMetaCacheEntry> {
  return readSessionMetaCache();
}

export function getSessionMetaCacheEntry(sessionId: string): SessionMetaCacheEntry | null {
  if (!sessionId) {
    return null;
  }
  return readSessionMetaCache()[sessionId] ?? null;
}

export function upsertSessionMetaCacheEntry(entry: Omit<SessionMetaCacheEntry, 'updatedAt'>): Record<string, SessionMetaCacheEntry> {
  if (!entry.sessionId) {
    return readSessionMetaCache();
  }

  const next = readSessionMetaCache();
  next[entry.sessionId] = {
    ...next[entry.sessionId],
    ...entry,
    updatedAt: Date.now(),
  };
  return writeSessionMetaCache(next);
}

export function upsertSessionMetaCacheEntries(
  entries: Array<Omit<SessionMetaCacheEntry, 'updatedAt'>>,
): Record<string, SessionMetaCacheEntry> {
  const next = readSessionMetaCache();
  for (const entry of entries) {
    if (!entry.sessionId) {
      continue;
    }
    next[entry.sessionId] = {
      ...next[entry.sessionId],
      ...entry,
      updatedAt: Date.now(),
    };
  }
  return writeSessionMetaCache(next);
}

export function removeSessionMetaCacheEntry(sessionId: string): Record<string, SessionMetaCacheEntry> {
  const next = readSessionMetaCache();
  delete next[sessionId];
  return writeSessionMetaCache(next);
}

function getChatViewCacheMap(): Map<string, ChatSessionViewCacheEntry> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[CHAT_VIEW_CACHE_KEY]) {
    globalObject[CHAT_VIEW_CACHE_KEY] = new Map<string, ChatSessionViewCacheEntry>(
      Object.entries(readChatViewCache()),
    );
  }
  return globalObject[CHAT_VIEW_CACHE_KEY] as Map<string, ChatSessionViewCacheEntry>;
}

function readChatViewCache(): Record<string, ChatSessionViewCacheEntry> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = readCompatibleStorageValue(
      getSessionStorageSafe(),
      CHAT_VIEW_STORAGE_KEY,
      LEGACY_CHAT_VIEW_STORAGE_KEYS,
    );
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, ChatSessionViewCacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistChatViewCache(map: Map<string, ChatSessionViewCacheEntry>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const record = Object.fromEntries(map.entries());
    writeStorageValue(getSessionStorageSafe(), CHAT_VIEW_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // best effort
  }
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
  persistChatViewCache(map);
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
  const map = getChatViewCacheMap();
  map.delete(sessionId);
  persistChatViewCache(map);
}
