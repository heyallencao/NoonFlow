import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message } from '../../types';
import { buildConversationHistoryForPrompt } from '../../lib/chat-route-history';

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    role: overrides.role,
    content: overrides.content,
    created_at: overrides.created_at ?? '2026-03-20T10:00:00.000Z',
    token_usage: overrides.token_usage ?? null,
    client_message_id: overrides.client_message_id ?? null,
    db_message_id: overrides.db_message_id ?? null,
    status: overrides.status ?? null,
    content_format_version: overrides.content_format_version ?? null,
    completed_at: overrides.completed_at ?? null,
    persisted_revision: overrides.persisted_revision ?? null,
  };
}

describe('chat route fallback conversation history', () => {
  it('excludes the entire restarted turn for duplicate client_message_id retries', () => {
    const previousUser = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'earlier prompt',
      client_message_id: 'msg-000',
    });
    const previousAssistant = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'earlier answer',
      client_message_id: 'msg-000',
    });
    const retriedUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'retry prompt',
      client_message_id: 'msg-retry',
    });
    const staleAssistant = createMessage({
      id: 'msg-assistant-1',
      role: 'assistant',
      content: 'stale failed answer',
      client_message_id: 'msg-retry',
      status: 'error',
    });

    const history = buildConversationHistoryForPrompt(
      [previousUser, previousAssistant, retriedUser, staleAssistant],
      retriedUser.id,
      'msg-retry',
    );

    assert.deepEqual(history, [
      { role: 'user', content: 'earlier prompt' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
  });

  it('excludes only the current user row when there is no client_message_id', () => {
    const previousUser = createMessage({
      id: 'msg-user-0',
      role: 'user',
      content: 'earlier prompt',
    });
    const previousAssistant = createMessage({
      id: 'msg-assistant-0',
      role: 'assistant',
      content: 'earlier answer',
    });
    const currentUser = createMessage({
      id: 'msg-user-1',
      role: 'user',
      content: 'latest prompt',
    });

    const history = buildConversationHistoryForPrompt(
      [previousUser, previousAssistant, currentUser],
      currentUser.id,
      null,
    );

    assert.deepEqual(history, [
      { role: 'user', content: 'earlier prompt' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
  });
});
