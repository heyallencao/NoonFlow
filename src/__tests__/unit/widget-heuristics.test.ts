import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shouldInjectWidgetPrompt } from '../../lib/widget-heuristics';

describe('widget heuristics', () => {
  it('enables prompt for visualization request in claude runtime', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'code',
      generativeUISettingEnabled: true,
      messageContent: 'Please visualize this data with a chart.',
    });
    assert.equal(enabled, true);
  });

  it('disables prompt when setting is off', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'code',
      generativeUISettingEnabled: false,
      messageContent: '请做一个图表',
    });
    assert.equal(enabled, false);
  });

  it('disables prompt for ask mode', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'ask',
      generativeUISettingEnabled: true,
      messageContent: 'draw a chart',
    });
    assert.equal(enabled, false);
  });

  it('enables prompt for plan mode when visualization intent exists', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'plan',
      generativeUISettingEnabled: true,
      messageContent: '先做一个计划，然后给我画出流程图',
    });
    assert.equal(enabled, true);
  });

  it('keeps prompt enabled for continuity when recent history contains show-widget', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'code',
      generativeUISettingEnabled: true,
      messageContent: 'continue',
      recentHistory: [
        { role: 'assistant', content: '```show-widget\n{"title":"a","widget_code":"<svg></svg>"}\n```' },
      ],
    });
    assert.equal(enabled, true);
  });

  it('enables prompt when system prompt append asks for visualization', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'claude_code',
      mode: 'code',
      generativeUISettingEnabled: true,
      messageContent: 'continue',
      systemPromptAppend: 'Please add a chart summary section.',
    });
    assert.equal(enabled, true);
  });

  it('enables prompt for visualization request in codex runtime', () => {
    const enabled = shouldInjectWidgetPrompt({
      runtime: 'codex',
      mode: 'code',
      generativeUISettingEnabled: true,
      messageContent: 'make a chart',
    });
    assert.equal(enabled, true);
  });
});
