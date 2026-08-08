import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message, SessionStreamSnapshot } from '../../types';
import {
  applySnapshotToOptimisticAssistantMessage,
  buildOptimisticAssistantMessage,
  buildOptimisticAssistantMessageId,
  buildSnapshotAssistantContent,
  buildTerminalAssistantContent,
} from '../../lib/chat-streaming-message';

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
  };
}

describe('chat-streaming-message', () => {
  it('builds a stable optimistic assistant id from clientMessageId', () => {
    assert.equal(
      buildOptimisticAssistantMessageId('msg-123'),
      'temp-assistant-msg-123',
    );
  });

  it('creates an optimistic assistant shell tied to client_message_id', () => {
    const message = buildOptimisticAssistantMessage('session-1', 'msg-123', '2026-03-18T12:00:00.000Z');

    assert.deepEqual(message, {
      id: 'temp-assistant-msg-123',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      created_at: '2026-03-18T12:00:00.000Z',
      token_usage: null,
      client_message_id: 'msg-123',
    });
  });

  it('builds live assistant content from streaming blocks before completion', () => {
    const content = buildSnapshotAssistantContent(createSnapshot({
      streamingContent: 'final text',
      streamingReasoning: 'thinking',
      toolUses: [{ id: 'tool-1', name: 'Read', input: { path: 'a.ts' } }],
      toolResults: [{ tool_use_id: 'tool-1', content: 'done', is_error: false }],
      streamingBlocks: [
        { id: 'reasoning-1', type: 'reasoning', text: 'thinking' },
        { id: 'tool-1-block', type: 'tool', tool_use_id: 'tool-1' },
        { id: 'text-1', type: 'text', text: 'final text' },
      ],
    }));

    const parsed = JSON.parse(content) as Array<{ type: string }>;
    assert.deepEqual(
      parsed.map((block) => block.type),
      ['reasoning', 'tool_use', 'tool_result', 'text'],
    );
  });

  it('falls back to finalMessageContent when terminal snapshot blocks are unavailable', () => {
    const content = buildSnapshotAssistantContent(createSnapshot({
      finalMessageContent: 'persisted terminal content',
    }));

    assert.equal(content, 'persisted terminal content');
  });

  it('prefers streaming blocks over finalMessageContent when terminal snapshot still has the last frame', () => {
    const content = buildSnapshotAssistantContent(createSnapshot({
      finalMessageContent: 'stale terminal content',
      streamingContent: 'final text',
      streamingReasoning: 'thinking',
      streamingBlocks: [
        { id: 'reasoning-1', type: 'reasoning', text: 'thinking' },
        { id: 'text-1', type: 'text', text: 'final text' },
      ],
    }));

    const parsed = JSON.parse(content) as Array<{ type: string; text?: string }>;
    assert.deepEqual(
      parsed.map((block) => block.type),
      ['reasoning', 'text'],
    );
    assert.equal(parsed[1]?.text, 'final text');
  });

  it('builds a terminal error fallback when the stream ends without assistant content', () => {
    const content = buildTerminalAssistantContent(
      createSnapshot({
        phase: 'error',
        error: 'provider overloaded',
      }),
      '模型有问题，调用失败，请稍后重试。',
    );

    assert.equal(content, '模型有问题，调用失败，请稍后重试。\n\n错误详情：provider overloaded');
  });

  it('returns empty terminal content for non-error terminal snapshots with no renderable blocks', () => {
    const content = buildTerminalAssistantContent(
      createSnapshot({
        phase: 'stopped',
      }),
      '模型有问题，调用失败，请稍后重试。',
    );

    assert.equal(content, '');
  });

  it('applies snapshot content and token usage to an optimistic assistant message', () => {
    const optimisticMessage: Message = buildOptimisticAssistantMessage(
      'session-1',
      'msg-123',
      '2026-03-18T12:00:00.000Z',
    );

    const updated = applySnapshotToOptimisticAssistantMessage(optimisticMessage, createSnapshot({
      streamingContent: 'hello world',
      tokenUsage: { input_tokens: 10, output_tokens: 20 },
    }));

    assert.equal(updated.content, 'hello world');
    assert.equal(updated.client_message_id, 'msg-123');
    assert.equal(
      updated.token_usage,
      JSON.stringify({ input_tokens: 10, output_tokens: 20 }),
    );
  });
});
