import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compileDeclarativeWidgetPayload, compileTabularWidgetFence } from '../../lib/widget-compiler';
import {
  buildShowWidgetRenderPlan,
  hasWidgetProtocolCandidate,
  stripCompletedWidgetProtocolBlocks,
  stripTrailingWidgetProtocolBlocks,
} from '../../lib/widget-sanitizer';

describe('widget compiler', () => {
  it('compiles declarative dashboard payload to widget_code', () => {
    const payload = {
      title: 'Q1 Revenue',
      template: 'bar',
      data: [
        { label: 'Jan', value: 12 },
        { label: 'Feb', value: 18 },
        { label: 'Mar', value: 23 },
      ],
    };
    const compiled = compileDeclarativeWidgetPayload(payload);
    assert.ok(compiled);
    assert.equal(compiled?.title, 'Q1 Revenue');
    assert.equal(compiled?.widget_code.includes('<svg'), true);
  });

  it('compiles nested sections payload by selecting a valid candidate', () => {
    const payload = {
      title: 'Delivery',
      sections: [
        { title: 'Roadmap', template: 'timeline', data: [{ title: 'Plan' }, { title: 'Build' }] },
      ],
    };
    const compiled = compileDeclarativeWidgetPayload(payload);
    assert.ok(compiled);
    assert.equal(compiled?.title, 'Roadmap');
    assert.equal(compiled?.widget_code.includes('<svg'), true);
  });

  it('compiles widget-table fence payload to a chart/table widget', () => {
    const compiled = compileTabularWidgetFence('table', [
      '| channel | value |',
      '| --- | --- |',
      '| organic | 42 |',
      '| ads | 18 |',
    ].join('\n'));
    assert.ok(compiled);
    assert.equal(compiled?.widget_code.length ? compiled.widget_code.includes('<svg') || compiled.widget_code.includes('<table') : false, true);
  });

  it('parses widget-dashboard and widget-table fences in render plan', () => {
    const markdown = [
      'Summary:',
      '```widget-dashboard',
      '{"title":"Sales","template":"line","data":[{"label":"W1","value":10},{"label":"W2","value":14}]}',
      '```',
      '```widget-table',
      '| item | value |',
      '| --- | --- |',
      '| A | 2 |',
      '| B | 3 |',
      '```',
    ].join('\n');
    const plan = buildShowWidgetRenderPlan(markdown);
    assert.equal(plan.widgetCount, 2);
    assert.equal(plan.hasMalformedWidget, false);
  });

  it('parses declarative json fences as widgets', () => {
    const markdown = [
      '```json',
      '{"title":"Conversion","template":"pie","dataset":[{"label":"Win","value":7},{"label":"Lose","value":3}]}',
      '```',
    ].join('\n');
    const plan = buildShowWidgetRenderPlan(markdown);
    assert.equal(plan.widgetCount, 1);
    assert.equal(plan.hasMalformedWidget, false);
  });

  it('keeps ordinary json fences with data fields as text', () => {
    const markdown = [
      'Before',
      '```json',
      '{"kind":"record","data":{"hello":"world","count":2}}',
      '```',
      'After',
    ].join('\n');
    const plan = buildShowWidgetRenderPlan(markdown);
    assert.equal(plan.widgetCount, 0);
    assert.equal(plan.hasMalformedWidget, false);
    assert.equal(hasWidgetProtocolCandidate(markdown), false);

    const stripped = stripCompletedWidgetProtocolBlocks(markdown);
    assert.equal(stripped, markdown);
  });

  it('does not strip trailing incomplete plain json fences during streaming', () => {
    const markdown = [
      'Before',
      '```json',
      '{"data":{"hello":"world","count":2}}',
    ].join('\n');
    assert.equal(hasWidgetProtocolCandidate(markdown), false);
    assert.equal(stripTrailingWidgetProtocolBlocks(markdown), markdown);
  });

  it('detects candidate fences and strips completed widget protocol blocks', () => {
    const markdown = [
      'Before',
      '```widget-dashboard',
      '{"title":"A","template":"bar","data":[{"label":"x","value":1}]}',
      '```',
      'After',
    ].join('\n');
    assert.equal(hasWidgetProtocolCandidate(markdown), true);
    const stripped = stripCompletedWidgetProtocolBlocks(markdown);
    assert.equal(stripped.includes('widget-dashboard'), false);
    assert.equal(stripped.includes('Before'), true);
    assert.equal(stripped.includes('After'), true);
  });

  it('strips trailing widget protocol blocks in streaming fallback path', () => {
    const markdown = [
      'Partial',
      '```widget-dashboard',
      '{"title":"A","template":"bar","data":[{"label":"x","value":1}]}',
    ].join('\n');
    const stripped = stripTrailingWidgetProtocolBlocks(markdown);
    assert.equal(stripped, 'Partial');
  });

  it('keeps trailing plain text after a closed widget block', () => {
    const markdown = [
      'before',
      '```widget-dashboard',
      '{"title":"A","template":"bar","data":[{"label":"x","value":1}]}',
      '```',
      'after',
    ].join('\n');
    const stripped = stripTrailingWidgetProtocolBlocks(markdown);
    assert.equal(stripped, markdown);
  });
});
