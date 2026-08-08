import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatContextLimitExceededMessage,
  normalizeContextLimitErrorMessage,
  prepareConversationContext,
} from '../../lib/context-budget';

describe('prepareConversationContext', () => {
  it('normalizes structured assistant history into compact plain text blocks', () => {
    const assistantHistory = JSON.stringify([
      { type: 'reasoning', text: 'internal reasoning should be omitted' },
      { type: 'text', text: 'Completed the refactor and verified the result.' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'src/app.ts' } },
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'Error: failed to open src/app.ts\n' + 'x'.repeat(800),
        is_error: true,
      },
    ]);

    const prepared = prepareConversationContext({
      runtime: 'codex',
      prompt: 'Continue from there',
      conversationHistory: [
        { role: 'assistant', content: assistantHistory },
      ],
      useConversationHistory: true,
      includeSystemPrompt: false,
      limits: {
        warningLimit: 10_000,
        softLimit: 20_000,
        hardLimit: 40_000,
      },
    });

    assert.equal(prepared.conversationHistory.length, 1);
    const content = prepared.conversationHistory[0]?.content || '';
    assert.doesNotMatch(content, /internal reasoning should be omitted/);
    assert.match(content, /\[Used tool: Read\]/);
    assert.match(content, /\[Tool error:/);
  });

  it('compacts older history first while preserving the recent user window', () => {
    const history = Array.from({ length: 7 }, (_value, index) => ([
      {
        role: 'user' as const,
        content: `Request ${index + 1}: ` + 'u'.repeat(220),
      },
      {
        role: 'assistant' as const,
        content: JSON.stringify([
          { type: 'text', text: `Answer ${index + 1}: ` + 'a'.repeat(700) },
          {
            type: 'tool_result',
            tool_use_id: `tool-${index + 1}`,
            content: 'tool output '.repeat(80),
          },
        ]),
      },
    ])).flat();

    const prepared = prepareConversationContext({
      runtime: 'codex',
      prompt: 'Ship the final patch',
      conversationHistory: history,
      useConversationHistory: true,
      includeSystemPrompt: true,
      systemPrompt: 'Follow repository conventions.',
      limits: {
        warningLimit: 1_200,
        softLimit: 1_700,
        hardLimit: 2_200,
      },
    });

    const renderedHistory = prepared.conversationHistory.map((message) => message.content).join('\n');
    assert.equal(prepared.localCompactionAttempted, true);
    assert.equal(prepared.hardTrimApplied, true);
    assert.ok(prepared.breakdown.total < prepared.initialBreakdown.total);
    assert.doesNotMatch(renderedHistory, /Request 1:/);
    assert.match(renderedHistory, /Request 7:/);
  });

  it('skips history budgeting when runtime-native resume is active', () => {
    const prepared = prepareConversationContext({
      runtime: 'claude',
      prompt: 'Only this turn should be sent',
      systemPrompt: 'Repository policy',
      conversationHistory: [
        { role: 'user', content: 'Older message' },
        { role: 'assistant', content: 'Older answer' },
      ],
      useConversationHistory: false,
      includeSystemPrompt: true,
      nativeResumeActive: true,
      limits: {
        warningLimit: 100,
        softLimit: 150,
        hardLimit: 200,
      },
    });

    assert.equal(prepared.nativeResumeActive, true);
    assert.deepEqual(prepared.conversationHistory, []);
    assert.equal(prepared.breakdown.history, 0);
    assert.equal(prepared.breakdown.tools, 0);
  });
});

describe('context limit error normalization', () => {
  it('formats a recoverable error message with budget breakdown fields', () => {
    const message = formatContextLimitExceededMessage({
      breakdown: {
        total: 1_200,
        system: 400,
        history: 300,
        tools: 250,
        user: 150,
        metadata: 100,
        bytes: 1_600,
        utilizationPct: 115,
        warningLimit: 700,
        softLimit: 850,
        hardLimit: 1_048,
        stage: 'hard',
      },
      nativeResumeActive: false,
      officialCompactAttempted: false,
      localCompactionAttempted: true,
    });

    assert.match(message, /compiled_input_chars=1200/);
    assert.match(message, /tool_output=250/);
    assert.match(message, /local_compaction_attempted=true/);
  });

  it('normalizes raw runtime limit errors into the shared user-facing wording', () => {
    const normalized = normalizeContextLimitErrorMessage(
      'turn/start failed: Input exceeds the maximum length of 1048576 characters',
    );

    assert.match(normalized, /本轮上下文超出限制/);
    assert.match(normalized, /hard_limit=1048576 chars/);
  });
});
