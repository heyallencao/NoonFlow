import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message } from '../../types';
import { selectChatTimelineSession } from '../../lib/chat/selectors';
import {
  getCachedChatSessionView,
  getSessionMetaCacheEntry,
  upsertSessionMetaCacheEntry,
} from '../../lib/session-client-cache';
import { useChatSessionViewStore } from '../../stores/chat-session-view-store';
import { useChatTimelineStore } from '../../stores/chat-timeline-store';

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    role: overrides.role,
    content: overrides.content,
    created_at: overrides.created_at ?? '2026-03-19T10:00:00.000Z',
    token_usage: overrides.token_usage ?? null,
    client_message_id: overrides.client_message_id ?? null,
    db_message_id: overrides.db_message_id ?? null,
    persisted_revision: overrides.persisted_revision ?? null,
  };
}

function getTimelineSession(sessionId: string) {
  return selectChatTimelineSession(useChatTimelineStore.getState(), sessionId);
}

afterEach(() => {
  useChatSessionViewStore.setState({ sessions: {} });
  useChatTimelineStore.setState({ sessions: {} });
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).__monolithChatSessionViewCache__;
  delete process.env.MONOLITH_CHAT_ROLLOUT_MODE;
  delete process.env.NEXT_PUBLIC_MONOLITH_CHAT_ROLLOUT_MODE;
});

describe('chat-timeline-store', () => {
  it('tracks optimistic assistant shells in the canonical timeline', () => {
    const assistantId = useChatTimelineStore
      .getState()
      .upsertOptimisticAssistant('session-1', 'msg-123');

    const timeline = getTimelineSession('session-1');

    assert.equal(assistantId, 'temp-assistant-msg-123');
    assert.equal(timeline.messages.length, 1);
    assert.equal(timeline.messages[0]?.client_message_id, 'msg-123');
    assert.equal(timeline.hasOptimisticMessages, true);
  });

  it('keeps the main server merge path as a canonical replace', () => {
    const optimisticUser = createMessage({
      id: 'temp-user-msg-123',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
    });
    const persistedUser = createMessage({
      id: 'db-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      created_at: '2026-03-19 10:00:00',
    });

    useChatTimelineStore.getState().replaceMessages('session-1', [optimisticUser]);
    const stillHasOptimistic = useChatTimelineStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser]);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['db-user-1'],
    );
  });

  it('keeps optimistic assistant output when the compatibility merge sees stale server rows', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'legacy';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatTimelineStore.getState().replaceMessages('session-1', [persistedUser, optimisticAssistant]);
    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');

    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.equal(timeline.hasOptimisticMessages, true);
  });

  it('lets session-view initial loads replace the timeline with canonical server rows', () => {
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });
    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [optimisticAssistant],
      hasMore: false,
    });
    useChatSessionViewStore.getState().setMessages('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');

    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1'],
    );
    assert.equal(timeline.hasOptimisticMessages, false);
  });

  it('keeps local append updates on timeline only until explicit view sync', () => {
    const initialUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const localSystem = createMessage({
      id: 'temp-system-1',
      role: 'assistant',
      content: 'local system note',
      created_at: '2026-03-19T10:00:01.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [initialUser],
      hasMore: false,
      loading: false,
      sessionResolved: true,
      sessionAssistantRuntime: 'codex',
    });

    useChatSessionViewStore.getState().appendMessage('session-1', localSystem);

    const timelineAfterAppend = getTimelineSession('session-1');
    const mirroredBeforeSync = useChatSessionViewStore.getState().sessions['session-1'];
    assert.deepEqual(
      timelineAfterAppend.messages.map((message) => message.id),
      ['msg-user-1', 'temp-system-1'],
    );
    assert.deepEqual(
      mirroredBeforeSync?.messages.map((message) => message.id),
      ['msg-user-1'],
    );

    useChatSessionViewStore.getState().syncMessagesFromTimeline('session-1', { persistCache: false });

    const mirroredAfterSync = useChatSessionViewStore.getState().sessions['session-1'];
    assert.deepEqual(
      mirroredAfterSync?.messages.map((message) => message.id),
      ['msg-user-1', 'temp-system-1'],
    );
  });

  it('hydrates cached view messages into the timeline immediately', () => {
    const cachedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'cached prompt',
    });
    const cachedAssistant = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'cached reply',
      created_at: '2026-03-19T10:00:01.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [cachedUser, cachedAssistant],
      hasMore: false,
      loading: false,
      sessionResolved: true,
      sessionAssistantRuntime: 'codex',
    });

    const timeline = getTimelineSession('session-1');
    const mirroredView = useChatSessionViewStore.getState().sessions['session-1'];

    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'msg-assistant-1'],
    );
    assert.deepEqual(
      mirroredView?.messages.map((message) => message.id),
      ['msg-user-1', 'msg-assistant-1'],
    );
  });

  it('clears timeline and client caches when a session is marked missing', () => {
    const sessionStorageData = new Map<string, string>();
    const localStorageData = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem(key: string) {
          return sessionStorageData.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          sessionStorageData.set(key, value);
        },
        removeItem(key: string) {
          sessionStorageData.delete(key);
        },
      },
      localStorage: {
        getItem(key: string) {
          return localStorageData.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          localStorageData.set(key, value);
        },
        removeItem(key: string) {
          localStorageData.delete(key);
        },
      },
    };

    const cachedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'cached prompt',
    });

    upsertSessionMetaCacheEntry({
      sessionId: 'session-1',
      title: 'Missing Session',
      workingDirectory: '/tmp/missing-session',
      sessionType: 'chat',
    });
    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [cachedUser],
      hasMore: false,
      loading: false,
      sessionResolved: true,
      sessionAssistantRuntime: 'codex',
    });

    assert.ok(getCachedChatSessionView('session-1'));
    assert.ok(getSessionMetaCacheEntry('session-1'));
    assert.equal(getTimelineSession('session-1').messages.length, 1);

    useChatSessionViewStore.getState().markSessionMissing('session-1');

    const view = useChatSessionViewStore.getState().sessions['session-1'];
    assert.equal(view?.error, 'Session not found');
    assert.equal(view?.messages.length, 0);
    assert.equal(view?.loading, false);
    assert.equal(view?.sessionResolved, true);
    assert.equal(getTimelineSession('session-1').messages.length, 0);
    assert.equal(getCachedChatSessionView('session-1'), null);
    assert.equal(getSessionMetaCacheEntry('session-1'), null);
  });

  it('lets chat-session-view-store reconcile against the current timeline state', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'legacy';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().appendMessage('session-1', persistedUser);
    useChatTimelineStore.getState().appendMessage('session-1', optimisticAssistant);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    const mirroredView = useChatSessionViewStore.getState().sessions['session-1'];

    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.deepEqual(
      mirroredView?.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
  });

  it('keeps local assistant key stable in bridge mode when persisted row arrives', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });
    const persistedAssistant = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'final reply',
      created_at: '2026-03-19T10:00:02.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().appendMessage('session-1', persistedUser);
    useChatTimelineStore.getState().appendMessage('session-1', optimisticAssistant);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser, persistedAssistant], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.equal(timeline.messages[1]?.db_message_id, 'msg-assistant-1');
  });

  it('uses compatibility fallback in bridge mode only for stale server snapshots', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().appendMessage('session-1', persistedUser);
    useChatTimelineStore.getState().appendMessage('session-1', optimisticAssistant);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
  });

  it('keeps a failed assistant reply visible when bridge resync has only the persisted user row', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
    });
    const failedAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: '模型有问题，调用失败，请稍后重试。\n\n错误详情：provider overloaded',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [persistedUser, failedAssistant]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.equal(timeline.messages[1]?.content, failedAssistant.content);
  });

  it('keeps projected persisted assistant shells in bridge mode when stale sync omits them', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const projectedPersistedAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'final streamed reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
      db_message_id: 'msg-assistant-1',
      persisted_revision: 3,
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().appendMessage('session-1', persistedUser);
    useChatTimelineStore.getState().appendMessage('session-1', projectedPersistedAssistant);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.equal(timeline.messages[1]?.db_message_id, 'msg-assistant-1');
  });

  it('drops local assistant carryover in bridge mode when server replies with equivalent persisted content without client id', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'final reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });
    const persistedAssistantWithoutClientId = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'final reply' }]),
      created_at: '2026-03-19T10:00:02.000Z',
      client_message_id: null,
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [persistedUser, optimisticAssistant]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser, persistedAssistantWithoutClientId], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.equal(
      timeline.messages.filter((message) => message.role === 'assistant').length,
      1,
    );
    assert.equal(timeline.messages[1]?.id, 'msg-assistant-1');
  });

  it('converges local temp user id to persisted server id during bridge merge', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const optimisticUser = createMessage({
      id: 'temp-user-msg-123',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      created_at: '2026-03-19T10:00:00.000Z',
    });
    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
      created_at: '2026-03-19T10:00:01.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [optimisticUser]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.equal(timeline.messages.length, 1);
    assert.equal(timeline.messages[0]?.id, 'msg-user-1');
    assert.equal(timeline.messages[0]?.db_message_id, 'msg-user-1');
  });

  it('drops stale temporary assistant carryover when newer persisted server messages exist', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const oldPersistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'old user',
      created_at: '2026-03-19T10:00:00.000Z',
    });
    const oldPersistedAssistant = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'old assistant',
      created_at: '2026-03-19T10:00:01.000Z',
    });
    const staleTemporaryAssistant = createMessage({
      id: 'temp-assistant-stale',
      role: 'assistant',
      content: 'generation stopped',
      client_message_id: null,
      created_at: '2026-03-19T10:00:02.000Z',
    });
    const newPersistedUser = createMessage({
      id: 'msg-user-2',
      role: 'user',
      content: 'new user',
      created_at: '2026-03-19T10:00:03.000Z',
    });
    const newPersistedAssistant = createMessage({
      id: 'msg-assistant-2',
      role: 'assistant',
      content: 'new assistant',
      created_at: '2026-03-19T10:00:04.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [
      oldPersistedUser,
      oldPersistedAssistant,
      staleTemporaryAssistant,
    ]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [
        oldPersistedUser,
        oldPersistedAssistant,
        newPersistedUser,
        newPersistedAssistant,
      ], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1', 'msg-assistant-1', 'msg-user-2', 'msg-assistant-2'],
    );
    assert.equal(
      timeline.messages.some((message) => message.id === 'temp-assistant-stale'),
      false,
    );
  });

  it('keeps the current bridge timeline when stale resync returns no messages', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const historicalUser = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'older prompt',
      client_message_id: 'msg-000',
      db_message_id: 'msg-user-0',
      created_at: '2026-03-19T09:59:58.000Z',
    });
    const historicalAssistant = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'older reply',
      created_at: '2026-03-19T09:59:59.000Z',
    });
    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [
      historicalUser,
      historicalAssistant,
      persistedUser,
      optimisticAssistant,
    ]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-0', 'msg-assistant-0', 'msg-user-1', 'temp-assistant-msg-123'],
    );
  });

  it('keeps locally persisted user rows in bridge mode when stale sync omits them without client ids', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const historicalUser = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'older prompt',
      created_at: '2026-03-19T09:59:58.000Z',
    });
    const historicalAssistant = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'older reply',
      created_at: '2026-03-19T09:59:59.000Z',
    });
    const locallyPersistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'new prompt',
      client_message_id: null,
      db_message_id: 'msg-user-1',
      created_at: '2026-03-19T10:00:00.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [
      historicalUser,
      historicalAssistant,
      locallyPersistedUser,
    ]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [historicalUser, historicalAssistant], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-0', 'msg-assistant-0', 'msg-user-1'],
    );
    assert.equal(timeline.messages[2]?.db_message_id, 'msg-user-1');
  });

  it('keeps a failed assistant reply beside its original prompt during later bridge resyncs', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'bridge';

    const historicalUser = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'first prompt',
      created_at: '2026-03-19T10:00:00.000Z',
    });
    const failedAssistant = createMessage({
      id: 'temp-assistant-msg-000',
      role: 'assistant',
      content: '模型有问题，调用失败，请稍后重试。\n\n错误详情：provider overloaded',
      client_message_id: 'msg-000',
      created_at: '2026-03-19T10:00:01.000Z',
    });
    const locallyPersistedNextUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'second prompt',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
      created_at: '2026-03-19T10:00:02.000Z',
    });
    const projectedPersistedAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'second reply',
      client_message_id: 'msg-123',
      db_message_id: 'msg-assistant-1',
      persisted_revision: 2,
      created_at: '2026-03-19T10:00:03.000Z',
    });
    const persistedNextUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'second prompt',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
      created_at: '2026-03-19T10:00:02.000Z',
    });
    const persistedNextAssistant = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'second reply',
      client_message_id: 'msg-123',
      created_at: '2026-03-19T10:00:03.000Z',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().replaceMessages('session-1', [
      historicalUser,
      failedAssistant,
      locallyPersistedNextUser,
      projectedPersistedAssistant,
    ]);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [
        historicalUser,
        persistedNextUser,
        persistedNextAssistant,
      ], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, true);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-0', 'temp-assistant-msg-000', 'msg-user-1', 'temp-assistant-msg-123'],
    );
    assert.equal(timeline.messages[1]?.content, failedAssistant.content);
    assert.equal(timeline.messages[3]?.db_message_id, 'msg-assistant-1');
  });

  it('uses canonical merge when rollout mode is canonical', () => {
    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'canonical';

    const persistedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistant = createMessage({
      id: 'temp-assistant-msg-123',
      role: 'assistant',
      content: 'partial reply',
      created_at: '2026-03-19T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      hasMore: false,
      loading: false,
    });
    useChatTimelineStore.getState().appendMessage('session-1', persistedUser);
    useChatTimelineStore.getState().appendMessage('session-1', optimisticAssistant);

    const stillHasOptimistic = useChatSessionViewStore
      .getState()
      .mergeMessagesFromServer('session-1', [persistedUser], false);

    const timeline = getTimelineSession('session-1');
    assert.equal(stillHasOptimistic, false);
    assert.deepEqual(
      timeline.messages.map((message) => message.id),
      ['msg-user-1'],
    );
  });

  it('avoids sessionStorage writes for active streaming timeline syncs', () => {
    let sessionStorageWrites = 0;
    const sessionStorageData = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem(key: string) {
          return sessionStorageData.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          sessionStorageWrites += 1;
          sessionStorageData.set(key, value);
        },
        removeItem(key: string) {
          sessionStorageData.delete(key);
        },
      },
    };

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [],
      hasMore: false,
      sessionAssistantRuntime: 'codex',
      loading: false,
      sessionResolved: true,
    });
    const writesAfterHydrate = sessionStorageWrites;

    useChatTimelineStore.getState().upsertOptimisticAssistant('session-1', 'msg-123');
    useChatSessionViewStore.getState().syncMessagesFromTimeline('session-1');
    const writesAfterShellSync = sessionStorageWrites;

    useChatTimelineStore.getState().syncOptimisticAssistantFromSnapshot(
      'session-1',
      {
        clientMessageId: 'msg-123',
        phase: 'active',
        streamingReasoning: '',
        streamingContent: 'partial reply',
        toolUses: [],
        toolResults: [],
        streamingBlocks: [],
        finalMessageContent: null,
        tokenUsage: null,
        error: null,
        persistedMessageId: null,
        persistedRevision: null,
      },
      'fallback',
    );
    useChatSessionViewStore.getState().syncMessagesFromTimeline('session-1');

    assert.equal(writesAfterHydrate, 1);
    assert.equal(writesAfterShellSync, writesAfterHydrate);
    assert.equal(sessionStorageWrites, writesAfterShellSync);
  });

  it('clears and evicts timeline sessions when the compatibility store does', () => {
    const message = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });

    useChatSessionViewStore.getState().hydrateSession('session-1', {
      messages: [message],
      hasMore: false,
    });
    useChatSessionViewStore.getState().clearMessages('session-1');

    assert.equal(getTimelineSession('session-1').messages.length, 0);

    useChatSessionViewStore.getState().evictSession('session-1');
    assert.equal(useChatTimelineStore.getState().sessions['session-1'], undefined);
  });

  it('applies persisted db ids and revisions onto the optimistic assistant shell', () => {
    useChatTimelineStore.getState().upsertOptimisticAssistant('session-1', 'msg-123');

    useChatTimelineStore.getState().syncOptimisticAssistantFromSnapshot(
      'session-1',
      {
        clientMessageId: 'msg-123',
        phase: 'active',
        streamingReasoning: '',
        streamingContent: 'partial reply',
        toolUses: [],
        toolResults: [],
        streamingBlocks: [],
        finalMessageContent: null,
        tokenUsage: null,
        error: null,
        persistedMessageId: 'db-msg-1',
        persistedRevision: 2,
      },
      'fallback',
    );

    useChatTimelineStore.getState().finalizeOptimisticAssistantFromSnapshot(
      'session-1',
      {
        clientMessageId: 'msg-123',
        phase: 'completed',
        streamingReasoning: '',
        streamingContent: 'partial reply',
        toolUses: [],
        toolResults: [],
        streamingBlocks: [],
        finalMessageContent: null,
        tokenUsage: null,
        error: null,
        persistedMessageId: 'db-msg-1',
        persistedRevision: 2,
      },
      'fallback',
    );

    const timeline = getTimelineSession('session-1');
    assert.equal(timeline.messages.length, 1);
    assert.equal(timeline.messages[0]?.db_message_id, 'db-msg-1');
    assert.equal(timeline.messages[0]?.persisted_revision, 2);
    assert.equal(timeline.hasOptimisticMessages, false);
  });

  it('acks a persisted user row onto the existing optimistic user shell', () => {
    useChatTimelineStore.getState().appendMessage('session-1', createMessage({
      id: 'temp-user-msg-123',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      created_at: '2026-03-19T10:00:00.000Z',
    }));

    useChatTimelineStore.getState().ackPersistedUser(
      'session-1',
      'msg-123',
      'db-user-1',
      '2026-03-19 10:00:01',
    );

    const timeline = getTimelineSession('session-1');
    assert.equal(timeline.messages.length, 1);
    assert.equal(timeline.messages[0]?.id, 'db-user-1');
    assert.equal(timeline.messages[0]?.db_message_id, 'db-user-1');
    assert.equal(timeline.messages[0]?.client_message_id, 'msg-123');
    assert.equal(timeline.hasOptimisticMessages, false);
  });

  it('merges a late persisted ack onto an already finalized assistant message', () => {
    useChatTimelineStore.getState().upsertOptimisticAssistant('session-1', 'msg-123');

    useChatTimelineStore.getState().finalizeOptimisticAssistantFromSnapshot(
      'session-1',
      {
        clientMessageId: 'msg-123',
        phase: 'completed',
        streamingReasoning: '',
        streamingContent: 'final reply',
        toolUses: [],
        toolResults: [],
        streamingBlocks: [],
        finalMessageContent: null,
        tokenUsage: null,
        error: null,
        persistedMessageId: null,
        persistedRevision: null,
      },
      'fallback',
    );

    useChatTimelineStore.getState().syncOptimisticAssistantFromSnapshot(
      'session-1',
      {
        clientMessageId: 'msg-123',
        phase: 'completed',
        streamingReasoning: '',
        streamingContent: '',
        toolUses: [],
        toolResults: [],
        streamingBlocks: [],
        finalMessageContent: null,
        tokenUsage: null,
        error: null,
        persistedMessageId: 'db-msg-1',
        persistedRevision: 3,
      },
      'fallback',
    );

    const timeline = getTimelineSession('session-1');
    assert.equal(timeline.messages.length, 1);
    assert.equal(timeline.messages[0]?.content, 'final reply');
    assert.equal(timeline.messages[0]?.db_message_id, 'db-msg-1');
    assert.equal(timeline.messages[0]?.persisted_revision, 3);
    assert.equal(timeline.hasOptimisticMessages, false);
  });
});
