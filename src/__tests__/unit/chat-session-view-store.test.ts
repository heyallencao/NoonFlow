import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message } from '../../types';
import {
  hasOptimisticMessages,
  reconcileMessagesWithOptimistic,
} from '../../lib/chat-message-reconciliation';

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    role: overrides.role,
    content: overrides.content,
    created_at: overrides.created_at ?? '2026-03-11T10:00:00.000Z',
    token_usage: overrides.token_usage ?? null,
    client_message_id: overrides.client_message_id ?? null,
    db_message_id: overrides.db_message_id ?? null,
  };
}

describe('chat-session-view-store optimistic message reconciliation', () => {
  it('keeps unmatched optimistic messages when the server response is stale', () => {
    const persistedUserMessage = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'partial reply\n\n*(generation stopped)*',
      created_at: '2026-03-11T10:00:01.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [persistedUserMessage, optimisticAssistantMessage],
      [persistedUserMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), true);
  });

  it('keeps completed transient assistant output visible until the persisted reply arrives', () => {
    const persistedUserMessage = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticCompletedAssistant = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: JSON.stringify([
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'final streamed reply' },
      ]),
      created_at: '2026-03-11T10:00:01.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [persistedUserMessage, optimisticCompletedAssistant],
      [persistedUserMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-1', 'temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), true);
  });

  it('keeps the current timeline when a stale resync temporarily returns no messages', () => {
    const historicalUserMessage = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'earlier prompt',
      client_message_id: 'msg-000',
    });
    const historicalAssistantMessage = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'earlier reply',
      created_at: '2026-03-11T09:59:59.000Z',
    });
    const persistedUserMessage = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'msg-user-1',
    });
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'partial reply\n\n*(generation stopped)*',
      created_at: '2026-03-11T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [
        historicalUserMessage,
        historicalAssistantMessage,
        persistedUserMessage,
        optimisticAssistantMessage,
      ],
      [],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-0', 'msg-assistant-0', 'msg-user-1', 'temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), true);
  });

  it('keeps a user_persisted message when the server resync is still missing that row', () => {
    const historicalUserMessage = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'earlier prompt',
    });
    const historicalAssistantMessage = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'earlier reply',
      created_at: '2026-03-11T09:59:59.000Z',
    });
    const persistedUserMessage = createMessage({
      id: 'db-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: 'msg-123',
      db_message_id: 'db-user-1',
    });
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'partial reply\n\n*(generation stopped)*',
      created_at: '2026-03-11T10:00:01.000Z',
      client_message_id: 'msg-123',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [
        historicalUserMessage,
        historicalAssistantMessage,
        persistedUserMessage,
        optimisticAssistantMessage,
      ],
      [historicalUserMessage, historicalAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-0', 'msg-assistant-0', 'db-user-1', 'temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), true);
  });

  it('keeps a locally persisted user row without client_message_id when stale server data omits it', () => {
    const historicalUserMessage = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'earlier prompt',
    });
    const historicalAssistantMessage = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'earlier reply',
      created_at: '2026-03-11T09:59:59.000Z',
    });
    const persistedUserMessage = createMessage({
      id: 'db-user-1',
      role: 'user',
      content: 'hello',
      client_message_id: null,
      db_message_id: 'db-user-1',
      created_at: '2026-03-11T10:00:00.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [
        historicalUserMessage,
        historicalAssistantMessage,
        persistedUserMessage,
      ],
      [historicalUserMessage, historicalAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-0', 'msg-assistant-0', 'db-user-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
  });

  it('drops optimistic messages once the server returns the persisted equivalent', () => {
    const persistedUserMessage = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'hello',
    });
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'partial reply\n\n*(generation stopped)*',
      created_at: '2026-03-11T10:00:01.000Z',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'partial reply\n\n*(generation stopped)*',
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [persistedUserMessage, optimisticAssistantMessage],
      [persistedUserMessage, persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-user-1', 'msg-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
  });

  it('prefers client_message_id over fingerprint when persisted content differs', () => {
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'partial streamed reply',
      token_usage: JSON.stringify({ output_tokens: 11 }),
      client_message_id: 'msg-123',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'persisted structured reply',
      token_usage: JSON.stringify({ output_tokens: 22 }),
      client_message_id: 'msg-123',
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [optimisticAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
    assert.equal(mergedMessages[0]?.content, 'partial streamed reply');
    assert.equal(mergedMessages[0]?.token_usage, JSON.stringify({ output_tokens: 22 }));
    assert.equal(mergedMessages[0]?.db_message_id, 'msg-assistant-1');
  });

  it('uses persisted content when the optimistic assistant shell is still empty', () => {
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: '',
      client_message_id: 'msg-123',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'persisted structured reply',
      client_message_id: 'msg-123',
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [optimisticAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['temp-assistant-1'],
    );
    assert.equal(mergedMessages[0]?.content, 'persisted structured reply');
    assert.equal(hasOptimisticMessages(mergedMessages), false);
    assert.equal(mergedMessages[0]?.db_message_id, 'msg-assistant-1');
  });

  it('uses db_message_id to keep the local assistant key stable on later syncs', () => {
    const locallyMergedAssistant = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'local structured reply',
      client_message_id: 'msg-123',
      db_message_id: 'msg-assistant-1',
      token_usage: JSON.stringify({ output_tokens: 11 }),
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'server structured reply',
      token_usage: JSON.stringify({ output_tokens: 22 }),
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [locallyMergedAssistant],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
    assert.equal(mergedMessages[0]?.db_message_id, 'msg-assistant-1');
    assert.equal(mergedMessages[0]?.content, 'local structured reply');
    assert.equal(mergedMessages[0]?.token_usage, JSON.stringify({ output_tokens: 22 }));
  });

  it('does not merge messages with different client_message_id values even when content matches', () => {
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'same text',
      client_message_id: 'msg-local',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'same text',
      client_message_id: 'msg-server',
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [optimisticAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-assistant-1', 'temp-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), true);
  });

  it('falls back to fingerprint matching when the server message has not stored client_message_id yet', () => {
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'same text',
      client_message_id: 'msg-local',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'same text',
      client_message_id: null,
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [optimisticAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
  });

  it('matches persisted structured text content against optimistic plain text output', () => {
    const optimisticAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'same text',
      client_message_id: 'msg-local',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'same text' }]),
      client_message_id: null,
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [optimisticAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
  });

  it('consumes only one optimistic duplicate for each persisted match', () => {
    const firstOptimisticAssistant = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: 'same text',
    });
    const secondOptimisticAssistant = createMessage({
      id: 'temp-assistant-2',
      role: 'assistant',
      content: 'same text',
      created_at: '2026-03-11T10:00:02.000Z',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'same text',
      created_at: '2026-03-11T10:00:03.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [firstOptimisticAssistant, secondOptimisticAssistant],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-assistant-1', 'temp-assistant-2'],
    );
  });

  it('drops transient assistant placeholders once a newer persisted assistant arrives', () => {
    const transientAssistantMessage = createMessage({
      id: 'temp-assistant-1',
      role: 'assistant',
      content: '{"type":"text","text":"streamed order"}',
      created_at: '2026-03-11T10:00:01.000Z',
    });
    const persistedAssistantMessage = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: '{"type":"tool_result","content":"persisted order"}',
      created_at: '2026-03-11T10:00:02.000Z',
    });

    const mergedMessages = reconcileMessagesWithOptimistic(
      [transientAssistantMessage],
      [persistedAssistantMessage],
    );

    assert.deepEqual(
      mergedMessages.map((message) => message.id),
      ['msg-assistant-1'],
    );
    assert.equal(hasOptimisticMessages(mergedMessages), false);
  });
});
