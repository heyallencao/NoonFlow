import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Message, SessionStreamSnapshot } from '../../types';
import { calculateContextUsage } from '../../lib/context-usage';

function createMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    role: overrides.role,
    content: overrides.content,
    created_at: overrides.created_at ?? '2026-03-24T10:00:00.000Z',
    token_usage: overrides.token_usage ?? null,
    client_message_id: overrides.client_message_id ?? null,
    db_message_id: overrides.db_message_id ?? null,
    persisted_revision: overrides.persisted_revision ?? null,
  };
}

function createSnapshot(
  overrides: Partial<Pick<SessionStreamSnapshot, 'phase' | 'tokenUsage' | 'clientMessageId'>>,
): Pick<SessionStreamSnapshot, 'phase' | 'tokenUsage' | 'clientMessageId'> {
  return {
    phase: overrides.phase ?? 'completed',
    tokenUsage: overrides.tokenUsage ?? null,
    clientMessageId: overrides.clientMessageId ?? null,
  };
}

describe('context usage', () => {
  it('uses the current streaming turn usage without accumulating prior turns', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-0',
        role: 'assistant',
        content: 'older reply',
        client_message_id: 'turn-0',
        token_usage: JSON.stringify({ input_tokens: 80, output_tokens: 10 }),
      }),
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'partial reply',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 120, output_tokens: 30 }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({
        phase: 'active',
        clientMessageId: 'turn-1',
        tokenUsage: { input_tokens: 120, output_tokens: 30 },
      }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 150);
    assert.equal(result.usedPct, 15);
    assert.equal(result.contextWindowSize, 1_000);
  });

  it('uses the latest completed assistant turn instead of accumulating all prior request totals', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'reply one',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 100, output_tokens: 20 }),
      }),
      createMessage({
        id: 'msg-assistant-2',
        role: 'assistant',
        content: 'reply two',
        client_message_id: 'turn-2',
        token_usage: JSON.stringify({ input_tokens: 180, output_tokens: 30 }),
      }),
      createMessage({
        id: 'msg-assistant-3',
        role: 'assistant',
        content: 'reply three',
        client_message_id: 'turn-3',
        token_usage: JSON.stringify({ input_tokens: 260, output_tokens: 40 }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({
        phase: 'completed',
        clientMessageId: null,
        tokenUsage: null,
      }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 300);
    assert.equal(result.usedPct, 30);
    assert.equal(result.contextWindowSize, 1_000);
  });

  it('keeps completed assistant usage after streaming is over', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'final reply',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 240, output_tokens: 20 }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({
        phase: 'completed',
        clientMessageId: 'turn-1',
        tokenUsage: { input_tokens: 240, output_tokens: 20 },
      }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 260);
    assert.equal(result.usedPct, 26);
    assert.equal(result.contextWindowSize, 1_000);
  });

  it('includes output and cache tokens in the current turn total', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'reply with cache',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({ phase: 'completed' }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 195); // 100 + 20 + 50 + 25
    assert.equal(result.usedPct, 20); // 195/1000 = 19.5% -> 20%
  });

  it('caps percentage at 100%', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'overflow',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 1800, output_tokens: 300 }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({ phase: 'completed' }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 2100);
    assert.equal(result.usedPct, 100); // capped at 100%
  });

  it('uses provider model labels to resolve generic aliases before applying defaults', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'provider alias reply',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 100_000, output_tokens: 20_000 }),
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({ phase: 'completed' }),
      'sonnet',
      '',
      'Kimi K2.5',
    );

    assert.equal(result.totalTokens, 120_000);
    assert.equal(result.contextWindowSize, 2_000_000);
    assert.equal(result.usedPct, 6);
  });

  it('falls back to the latest completed assistant turn when the current stream has not emitted usage yet', () => {
    const messages = [
      createMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'latest completed reply',
        client_message_id: 'turn-1',
        token_usage: JSON.stringify({ input_tokens: 180, output_tokens: 20 }),
      }),
      createMessage({
        id: 'msg-assistant-2',
        role: 'assistant',
        content: 'new reply still starting',
        client_message_id: 'turn-2',
        token_usage: null,
      }),
    ];

    const result = calculateContextUsage(
      messages,
      createSnapshot({
        phase: 'active',
        clientMessageId: 'turn-2',
        tokenUsage: null,
      }),
      'gpt-5',
      '{"gpt-5":1000}',
    );

    assert.equal(result.totalTokens, 200);
    assert.equal(result.usedPct, 20);
  });
});
