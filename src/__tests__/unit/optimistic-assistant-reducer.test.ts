import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message, SessionStreamSnapshot } from '../../types';
import {
  finalizeOptimisticAssistantFromSnapshot,
  syncOptimisticAssistantFromSnapshot,
  upsertOptimisticAssistantMessage,
} from '../../lib/chat/optimistic-assistant-reducer';

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
  };
}

function createSnapshot(
  overrides: Partial<SessionStreamSnapshot> = {},
): SessionStreamSnapshot {
  return {
    sessionId: 'session-1',
    clientMessageId: 'msg-123',
    phase: 'active',
    streamingContent: '',
    streamingReasoning: '',
    toolUses: [],
    toolResults: [],
    streamingBlocks: [],
    streamingToolOutput: '',
    statusText: undefined,
    pendingPermission: null,
    permissionResolved: null,
    tokenUsage: null,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    finalMessageContent: null,
    ...overrides,
    childActivities: overrides.childActivities ?? [],
  };
}

const FAILURE_FALLBACK_MESSAGE = '模型有问题，调用失败，请稍后重试。';

describe('optimistic-assistant-reducer', () => {
  it('creates an optimistic assistant shell once for a client message id', () => {
    const first = upsertOptimisticAssistantMessage([], 'session-1', 'msg-123');
    assert.equal(first.assistantId, 'temp-assistant-msg-123');
    assert.equal(first.messages.length, 1);

    const second = upsertOptimisticAssistantMessage(first.messages, 'session-1', 'msg-123');
    assert.equal(second.assistantId, 'temp-assistant-msg-123');
    assert.equal(second.messages.length, 1);
  });

  it('syncs streaming snapshot content into the optimistic assistant message', () => {
    const initial = upsertOptimisticAssistantMessage([], 'session-1', 'msg-123');
    const result = syncOptimisticAssistantFromSnapshot(
      initial.messages,
      'session-1',
      createSnapshot({
        streamingContent: 'hello world',
        tokenUsage: { input_tokens: 5, output_tokens: 8 },
      }),
      { failureFallbackMessage: FAILURE_FALLBACK_MESSAGE },
    );

    assert.equal(result.assistantId, 'temp-assistant-msg-123');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.content, 'hello world');
    assert.equal(
      result.messages[0]?.token_usage,
      JSON.stringify({ input_tokens: 5, output_tokens: 8 }),
    );
  });

  it('removes an empty optimistic assistant shell when terminal snapshot has nothing renderable', () => {
    const initialMessages = [
      createMessage({
        id: 'temp-assistant-msg-123',
        role: 'assistant',
        content: '',
        client_message_id: 'msg-123',
      }),
    ];

    const result = finalizeOptimisticAssistantFromSnapshot(
      initialMessages,
      'session-1',
      createSnapshot({
        phase: 'stopped',
      }),
      { failureFallbackMessage: FAILURE_FALLBACK_MESSAGE },
    );

    assert.equal(result.assistantId, 'temp-assistant-msg-123');
    assert.equal(result.messages.length, 0);
    assert.equal(result.shouldTransferPending, false);
  });

  it('keeps a stable assistant id and marks terminal content ready for transfer', () => {
    const initialMessages = [
      createMessage({
        id: 'temp-assistant-msg-123',
        role: 'assistant',
        content: '',
        client_message_id: 'msg-123',
      }),
    ];

    const result = finalizeOptimisticAssistantFromSnapshot(
      initialMessages,
      'session-1',
      createSnapshot({
        phase: 'error',
        error: 'provider overloaded',
      }),
      { failureFallbackMessage: FAILURE_FALLBACK_MESSAGE },
    );

    assert.equal(result.assistantId, 'temp-assistant-msg-123');
    assert.equal(result.shouldTransferPending, true);
    assert.equal(
      result.messages[0]?.content,
      '模型有问题，调用失败，请稍后重试。\n\n错误详情：provider overloaded',
    );
  });

  it('appends a transient assistant when a terminal snapshot has no client message id', () => {
    const result = finalizeOptimisticAssistantFromSnapshot(
      [],
      'session-1',
      createSnapshot({
        clientMessageId: null,
        phase: 'completed',
        finalMessageContent: 'persisted fallback reply',
      }),
      {
        failureFallbackMessage: FAILURE_FALLBACK_MESSAGE,
        now: () => new Date('2026-03-19T12:34:56.000Z'),
      },
    );

    assert.equal(result.shouldTransferPending, true);
    assert.equal(result.assistantId, 'temp-assistant-1773923696000');
    assert.equal(result.messages[0]?.content, 'persisted fallback reply');
  });
});
