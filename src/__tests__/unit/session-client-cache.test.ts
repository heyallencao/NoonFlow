import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isResolvedChatSessionCache, type ChatSessionViewCacheEntry } from '../../lib/session-client-cache';

function createCacheEntry(overrides: Partial<ChatSessionViewCacheEntry> = {}): ChatSessionViewCacheEntry {
  return {
    sessionId: overrides.sessionId ?? 'session-1',
    messages: overrides.messages ?? [],
    hasMore: overrides.hasMore ?? false,
    sessionTitle: overrides.sessionTitle ?? 'Test Session',
    sessionModel: overrides.sessionModel ?? '',
    sessionProviderId: overrides.sessionProviderId ?? '',
    sessionMode: overrides.sessionMode ?? 'code',
    sessionAssistantRuntime: overrides.sessionAssistantRuntime ?? '',
    sessionType: overrides.sessionType ?? 'chat',
    projectName: overrides.projectName ?? '',
    sessionWorkingDir: overrides.sessionWorkingDir ?? '',
    loadedFromServer: overrides.loadedFromServer,
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

describe('session-client-cache hydration readiness', () => {
  it('does not resolve chat sessions from metadata-only cache', () => {
    const cachedView = createCacheEntry({
      sessionAssistantRuntime: '',
      sessionModel: '',
    });

    assert.equal(isResolvedChatSessionCache(cachedView, 'chat'), false);
  });

  it('resolves chat sessions only when runtime metadata is present', () => {
    const cachedView = createCacheEntry({
      sessionAssistantRuntime: 'codex',
    });

    assert.equal(isResolvedChatSessionCache(cachedView, 'chat'), true);
  });

  it('always resolves terminal sessions', () => {
    const cachedView = createCacheEntry({
      sessionAssistantRuntime: '',
      sessionType: 'terminal',
    });

    assert.equal(isResolvedChatSessionCache(cachedView, 'terminal'), true);
  });
});
