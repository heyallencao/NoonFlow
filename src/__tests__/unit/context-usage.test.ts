import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Message, RuntimeContextState, SessionStreamSnapshot } from '../../types';
import { ContextUsageBar } from '../../components/chat/ContextUsageBar';
import {
  buildCompactionDisplay,
  calculateContextUsage,
  resolveRuntimeContextUsage,
} from '../../lib/context-usage';
import {
  clearRuntimeContextState,
  getRuntimeContextState,
  setRuntimeContextState,
  updateRuntimeContextState,
} from '../../lib/context-runtime';

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
  it('renders completed native compaction with token transition and timestamps', () => {
    const display = buildCompactionDisplay({
      status: 'completed',
      trigger: 'recovery',
      preTokens: 1_000,
      postTokens: 300,
      postTokensEstimated: false,
      startedAt: Date.parse('2026-08-09T01:02:03.000Z'),
      completedAt: Date.parse('2026-08-09T01:02:04.000Z'),
      error: null,
    });

    assert.equal(display?.status, 'completed');
    assert.match(display?.label ?? '', /压缩完成 1,000 → 300 tokens/);
    assert.match(display?.detail ?? '', /窗口溢出恢复/);
    assert.match(display?.detail ?? '', /2026-08-09T01:02:03.000Z/);
    assert.match(display?.detail ?? '', /2026-08-09T01:02:04.000Z/);
  });

  it('labels Pi estimated post-compaction tokens as approximate without creating occupancy', () => {
    const compaction = {
      status: 'completed' as const,
      trigger: 'auto' as const,
      preTokens: 900,
      postTokens: 240,
      postTokensEstimated: true,
      startedAt: 1,
      completedAt: 2,
      error: null,
    };
    const display = buildCompactionDisplay(compaction);
    const result = resolveRuntimeContextUsage({
      runtime: 'pi',
      currentContext: null,
      lastTurnUsage: { input_tokens: 3, output_tokens: 2 },
      source: 'unavailable',
      compaction,
      updatedAt: 2,
    }, 'pi', 128_000);

    assert.match(display?.label ?? '', /900 → 约 240 tokens/);
    assert.equal(result.source, 'unavailable');
    assert.equal(result.totalTokens, null);
    assert.equal(result.usedPct, null);
    assert.equal(result.contextWindowSize, 128_000);
    assert.equal(result.compaction, compaction);
  });

  it('renders native compaction failure details instead of hiding them', () => {
    const display = buildCompactionDisplay({
      status: 'failed',
      trigger: 'auto',
      preTokens: null,
      postTokens: null,
      postTokensEstimated: false,
      startedAt: Date.parse('2026-08-09T01:02:03.000Z'),
      completedAt: Date.parse('2026-08-09T01:02:05.000Z'),
      error: 'native compact timed out',
    });

    assert.equal(display?.status, 'failed');
    assert.equal(display?.label, '压缩失败：native compact timed out');
    assert.match(display?.detail ?? '', /自动触发/);
    assert.match(display?.detail ?? '', /native compact timed out/);
  });

  it('keeps native percentage visible beside completed and failed compaction states', () => {
    const baseProps = {
      totalTokens: 300,
      usedPct: 30,
      contextWindowSize: 1_000,
      lastTurnUsage: null,
      source: 'native' as const,
      isStreaming: false,
    };
    const completedMarkup = renderToStaticMarkup(createElement(ContextUsageBar, {
      ...baseProps,
      compaction: {
        status: 'completed',
        trigger: 'auto',
        preTokens: 900,
        postTokens: 300,
        postTokensEstimated: false,
        startedAt: Date.parse('2026-08-09T01:02:03.000Z'),
        completedAt: Date.parse('2026-08-09T01:02:04.000Z'),
        error: null,
      },
    }));
    const failedMarkup = renderToStaticMarkup(createElement(ContextUsageBar, {
      ...baseProps,
      compaction: {
        status: 'failed',
        trigger: 'auto',
        preTokens: null,
        postTokens: null,
        postTokensEstimated: false,
        startedAt: Date.parse('2026-08-09T01:02:03.000Z'),
        completedAt: Date.parse('2026-08-09T01:02:05.000Z'),
        error: 'native compact timed out',
      },
    }));

    assert.match(completedMarkup, />30%<.*压缩完成 900 → 300 tokens/);
    assert.match(completedMarkup, /结束 2026-08-09T01:02:04.000Z/);
    assert.match(failedMarkup, />30%<.*压缩失败：native compact timed out/);
  });

  it('hides unavailable occupancy instead of rendering an empty bar', () => {
    const markup = renderToStaticMarkup(createElement(ContextUsageBar, {
      totalTokens: null,
      usedPct: null,
      contextWindowSize: 128_000,
      lastTurnUsage: null,
      source: 'unavailable',
      compaction: { status: 'idle' },
      isStreaming: false,
    }));

    assert.equal(markup, '');
  });

  it('keeps Pi native turn and compaction facts without an unavailable occupancy bar', () => {
    const markup = renderToStaticMarkup(createElement(ContextUsageBar, {
      totalTokens: null,
      usedPct: null,
      contextWindowSize: 128_000,
      lastTurnUsage: { input_tokens: 10, output_tokens: 5 },
      source: 'unavailable',
      compaction: {
        status: 'completed',
        trigger: 'auto',
        preTokens: 900,
        postTokens: 240,
        postTokensEstimated: true,
        startedAt: 1,
        completedAt: 2,
        error: null,
      },
      isStreaming: false,
    }));

    assert.doesNotMatch(markup, /暂不可用|width:/);
    assert.match(markup, /压缩完成 900 → 约 240 tokens/);
    assert.match(markup, /本轮 15/);
  });

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
    assert.equal(result.source, 'estimated');
  });

  it('keeps native usage unavailable while using a default window only as a display fallback', () => {
    const result = resolveRuntimeContextUsage(null, 'codex', 200_000);

    assert.equal(result.source, 'unavailable');
    assert.equal(result.totalTokens, null);
    assert.equal(result.usedPct, null);
    assert.equal(result.contextWindowSize, 200_000);
    assert.equal(result.lastTurnUsage, null);
  });

  it('does not calculate a percentage from the display fallback when native total lacks a window', () => {
    const state: RuntimeContextState = {
      runtime: 'claude_code',
      currentContext: { usedTokens: 75_000, contextWindowTokens: null, percentage: null },
      lastTurnUsage: { input_tokens: 10, output_tokens: 5 },
      source: 'native',
      compaction: { status: 'idle' },
      updatedAt: 1,
    };

    const result = resolveRuntimeContextUsage(state, 'claude_code', 200_000);

    assert.equal(result.source, 'native');
    assert.equal(result.totalTokens, 75_000);
    assert.equal(result.usedPct, null);
    assert.equal(result.contextWindowSize, 200_000);
    assert.deepEqual(result.lastTurnUsage, { input_tokens: 10, output_tokens: 5 });
  });

  it('isolates a native state from a different runtime', () => {
    const state: RuntimeContextState = {
      runtime: 'codex',
      currentContext: { usedTokens: 420, contextWindowTokens: 1_000, percentage: 42 },
      lastTurnUsage: null,
      source: 'native',
      compaction: {
        status: 'completed',
        trigger: 'recovery',
        preTokens: 500,
        postTokens: 200,
        postTokensEstimated: false,
        startedAt: 1,
        completedAt: 2,
        error: null,
      },
      updatedAt: 1,
    };

    const result = resolveRuntimeContextUsage(state, 'pi', 128_000);

    assert.equal(result.source, 'unavailable');
    assert.equal(result.usedPct, null);
    assert.deepEqual(result.compaction, { status: 'idle' });
  });

  it('stores runtime context independently per session', () => {
    setRuntimeContextState('session-a', {
      runtime: 'codex',
      currentContext: { usedTokens: 100, contextWindowTokens: 1_000, percentage: 10 },
      lastTurnUsage: { input_tokens: 8, output_tokens: 2 },
      source: 'native',
      compaction: { status: 'idle' },
      updatedAt: 0,
    });
    setRuntimeContextState('session-b', {
      runtime: 'claude_code',
      currentContext: { usedTokens: 200, contextWindowTokens: 2_000, percentage: 10 },
      lastTurnUsage: { input_tokens: 15, output_tokens: 5 },
      source: 'native',
      compaction: {
        status: 'completed',
        trigger: 'auto',
        preTokens: 300,
        postTokens: 100,
        postTokensEstimated: false,
        startedAt: 1,
        completedAt: 2,
        error: null,
      },
      updatedAt: 0,
    });

    assert.equal(getRuntimeContextState('session-a')?.currentContext?.usedTokens, 100);
    assert.equal(getRuntimeContextState('session-b')?.currentContext?.usedTokens, 200);
    assert.equal(getRuntimeContextState('session-a')?.runtime, 'codex');
    assert.equal(getRuntimeContextState('session-b')?.runtime, 'claude_code');
    clearRuntimeContextState('session-a');
    clearRuntimeContextState('session-b');
  });

  it('replaces compaction lifecycle states atomically without leaking prior fields', () => {
    setRuntimeContextState('session-atomic', {
      runtime: 'codex',
      currentContext: null,
      lastTurnUsage: null,
      source: 'unavailable',
      compaction: {
        status: 'completed',
        trigger: 'auto',
        preTokens: 900,
        postTokens: 300,
        postTokensEstimated: false,
        startedAt: 10,
        completedAt: 20,
        error: null,
      },
      updatedAt: 0,
    });

    updateRuntimeContextState('session-atomic', 'codex', {
      compaction: {
        status: 'compacting',
        trigger: 'recovery',
        preTokens: 300,
        postTokens: null,
        postTokensEstimated: false,
        startedAt: 30,
        completedAt: null,
        error: null,
      },
    });
    assert.deepEqual(getRuntimeContextState('session-atomic')?.compaction, {
      status: 'compacting',
      trigger: 'recovery',
      preTokens: 300,
      postTokens: null,
      postTokensEstimated: false,
      startedAt: 30,
      completedAt: null,
      error: null,
    });
    clearRuntimeContextState('session-atomic');
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
