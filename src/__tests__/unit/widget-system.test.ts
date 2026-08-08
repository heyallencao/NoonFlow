import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildReceiverSrcdoc } from '../../lib/widget-css-bridge';
import { WIDGET_SYSTEM_PROMPT } from '../../lib/widget-guidelines';
import { getWidgetTelemetryEvents } from '../../lib/widget-telemetry';
import {
  buildShowWidgetRenderPlan,
  computePartialWidgetKey,
  parseAllShowWidgets,
  sanitizeForIframe,
  sanitizeForStreaming,
  stripTrailingIncompleteShowWidget,
} from '../../lib/widget-sanitizer';

describe('widget system', () => {
  it('sanitizes streaming html by removing scripts and dangerous handlers', () => {
    const raw = '<div onclick="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">x</a></div>';
    const sanitized = sanitizeForStreaming(raw);
    assert.equal(sanitized.includes('<script>'), false);
    assert.equal(sanitized.includes('onclick='), false);
    assert.equal(sanitized.includes('javascript:'), false);
  });

  it('sanitizes dangerous unquoted URL attributes', () => {
    const raw = '<a href=javascript:alert(1)>x</a><img src=data:text/html,evil />';
    const sanitized = sanitizeForStreaming(raw);
    assert.equal(sanitized.includes('href=javascript:'), false);
    assert.equal(sanitized.includes('href=#'), true);
    assert.equal(sanitized.includes('src=data:text/html'), false);
    assert.equal(sanitized.includes('src=#'), true);
  });

  it('blocks remote resource URLs but preserves anchor navigation intents', () => {
    const raw = [
      '<a href="https://example.com/report">report</a>',
      '<a href="ask:refine chart">refine</a>',
      '<img src="https://evil.example/pixel.png" />',
      '<svg><image href="https://evil.example/chart.svg" /></svg>',
    ].join('');
    const sanitized = sanitizeForIframe(raw);
    assert.equal(sanitized.includes('href="https://example.com/report"'), true);
    assert.equal(sanitized.includes('href="ask:refine chart"'), true);
    assert.equal(sanitized.includes('src="https://evil.example/pixel.png"'), false);
    assert.equal(sanitized.includes('src="#"'), true);
    assert.equal(sanitized.includes('href="https://evil.example/chart.svg"'), false);
  });

  it('removes unclosed script blocks in streaming sanitizer', () => {
    const raw = '<div>safe</div><script>const a = 1';
    const sanitized = sanitizeForStreaming(raw);
    assert.equal(sanitized.includes('script'), false);
    assert.equal(sanitized.includes('safe'), true);
  });

  it('supports parsing multiple show-widget blocks mixed with text', () => {
    const input = [
      'Before',
      '```show-widget',
      '{"title":"one","widget_code":"<svg><rect width=\\"10\\" height=\\"10\\"/></svg>"}',
      '```',
      'Middle',
      '```show-widget',
      '{"title":"two","widget_code":"<div>2</div>"}',
      '```',
      'After',
    ].join('\n');
    const parts = parseAllShowWidgets(input);
    const widgetParts = parts.filter((part) => part.type === 'widget');
    assert.equal(widgetParts.length, 2);
    assert.equal(widgetParts[0]?.type === 'widget' ? widgetParts[0].title : '', 'one');
    assert.equal(widgetParts[1]?.type === 'widget' ? widgetParts[1].title : '', 'two');
  });

  it('marks malformed show-widget blocks in render plan', () => {
    const malformed = [
      'before',
      '```show-widget',
      '{"title":"broken","widget_code":}',
      '```',
      'after',
    ].join('\n');
    const plan = buildShowWidgetRenderPlan(malformed);
    assert.equal(plan.widgetCount, 0);
    assert.equal(plan.hasMalformedWidget, true);
    assert.equal(plan.hasIncompleteWidget, false);
  });

  it('recovers malformed show-widget payload once when repairable', () => {
    const recoverable = [
      'before',
      '```show-widget',
      '{title:"sales_overview",widget_code:<svg><rect width="10" height="10" /></svg>}',
      '```',
      'after',
    ].join('\n');
    const plan = buildShowWidgetRenderPlan(recoverable);
    const widgets = plan.parts.filter((part) => part.type === 'widget');
    assert.equal(plan.widgetCount, 1);
    assert.equal(plan.hasMalformedWidget, false);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0]?.type === 'widget' ? widgets[0].title : '', 'sales_overview');
  });

  it('deduplicates parse/recover telemetry for repeated render-plan calls with same input', () => {
    const recoverable = [
      'before',
      '```show-widget',
      '{title:"sales_overview",widget_code:<svg><rect width="10" height="10" /></svg>}',
      '```',
      'after',
    ].join('\n');
    const marker = `telemetry-dedupe-${Date.now()}`;
    const before = getWidgetTelemetryEvents().length;
    buildShowWidgetRenderPlan(recoverable, {
      telemetry: {
        sessionId: marker,
        messageId: marker,
        traceId: marker,
      },
    });
    buildShowWidgetRenderPlan(recoverable, {
      telemetry: {
        sessionId: marker,
        messageId: marker,
        traceId: marker,
      },
    });
    const emitted = getWidgetTelemetryEvents().slice(before).filter((event) => event.messageId === marker);
    const parseEvents = emitted.filter((event) => event.event === 'widget_parse');
    const recoverEvents = emitted.filter((event) => event.event === 'widget_recover');
    assert.equal(parseEvents.length, 1);
    assert.equal(recoverEvents.length, 1);
  });

  it('marks incomplete show-widget blocks in live render plan', () => {
    const incomplete = 'hello\n```show-widget\n{"title":"x","widget_code":"<svg>"}';
    const plan = buildShowWidgetRenderPlan(incomplete, { liveStreaming: true });
    assert.equal(plan.hasIncompleteWidget, true);
  });

  it('marks dangling show-widget blocks as malformed in non-live mode', () => {
    const dangling = 'hello\n```show-widget\n{"title":"x","widget_code":"<svg>"}';
    const plan = buildShowWidgetRenderPlan(dangling, { liveStreaming: false });
    assert.equal(plan.hasIncompleteWidget, false);
    assert.equal(plan.hasMalformedWidget, true);
  });

  it('removes trailing incomplete show-widget blocks during streaming', () => {
    const input = 'hello\n```show-widget\n{"title":"x","widget_code":"<svg>"}';
    const stripped = stripTrailingIncompleteShowWidget(input);
    assert.equal(stripped.hasIncompleteWidget, true);
    assert.equal(stripped.text, 'hello');
  });

  it('builds deterministic widget keys', () => {
    const left = computePartialWidgetKey('same input');
    const right = computePartialWidgetKey('same input');
    const another = computePartialWidgetKey('different input');
    assert.equal(left, right);
    assert.notEqual(left, another);
  });

  it('keeps widget key stable when code changes but widget order/title stay the same', () => {
    const v1 = parseAllShowWidgets([
      'before',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg><rect width=\\"10\\"/></svg>"}',
      '```',
    ].join('\n'));

    const v2 = parseAllShowWidgets([
      'before',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg><rect width=\\"12\\"/></svg>"}',
      '```',
    ].join('\n'));

    const k1 = v1.find((part) => part.type === 'widget');
    const k2 = v2.find((part) => part.type === 'widget');
    assert.equal(k1?.type, 'widget');
    assert.equal(k2?.type, 'widget');
    assert.equal(k1?.type === 'widget' ? k1.key : '', k2?.type === 'widget' ? k2.key : '');
  });

  it('builds srcdoc with csp, bridge script and sanitized body', () => {
    const srcdoc = buildReceiverSrcdoc({
      html: '<div><script>alert(1)</script><a href="https://example.com">go</a></div>',
      title: 'demo',
      bridgeToken: 'token-123',
    });
    assert.equal(srcdoc.includes('Content-Security-Policy'), true);
    assert.equal(srcdoc.includes("connect-src 'none'"), true);
    assert.equal(srcdoc.includes('img-src data:'), true);
    assert.equal(srcdoc.includes('https: http:'), false);
    assert.equal(srcdoc.includes("source: 'noonflow-widget'"), true);
    assert.equal(srcdoc.includes("bridgeToken: BRIDGE_TOKEN"), true);
    assert.equal(srcdoc.includes('token-123'), true);
    assert.equal(srcdoc.includes('ResizeObserver'), true);
    assert.equal(srcdoc.includes('data-widget-send'), true);
    assert.equal(srcdoc.includes('<script>alert(1)</script>'), false);
    assert.equal(srcdoc.includes('https://example.com'), true);
    assert.equal(srcdoc.includes('min-height: 100vh;'), false);
  });

  it('always strips widget-authored scripts from iframe html', () => {
    const raw = '<div><script>window.x = 1</script></div>';
    const sanitized = sanitizeForIframe(raw);
    const srcdoc = buildReceiverSrcdoc({ html: raw });
    assert.equal(sanitized.includes('window.x = 1'), false);
    assert.equal(srcdoc.includes('window.x = 1'), false);
  });

  it('contains required show-widget constraints in system prompt', () => {
    assert.equal(WIDGET_SYSTEM_PROMPT.includes('```show-widget'), true);
    assert.equal(WIDGET_SYSTEM_PROMPT.includes('"title":"snake_case_id"'), true);
    assert.equal(WIDGET_SYSTEM_PROMPT.includes('"widget_code":"<valid HTML or SVG string>"'), true);
    assert.equal(WIDGET_SYSTEM_PROMPT.includes('Do not use script tags, external scripts, iframes, remote libraries, or remote asset URLs.'), true);
  });
});
