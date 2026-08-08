import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWidgetTraceId,
  getWidgetTelemetryEvents,
  publishWidgetTelemetry,
} from '../../lib/widget-telemetry';

describe('widget telemetry', () => {
  it('creates trace ids with optional seed prefix', () => {
    const trace = createWidgetTraceId('parse');
    assert.equal(trace.startsWith('w_parse_'), true);
  });

  it('stores emitted telemetry envelopes', () => {
    const before = getWidgetTelemetryEvents().length;
    publishWidgetTelemetry({
      event: 'widget_parse',
      ok: true,
      meta: { source: 'test' },
    });
    const afterEvents = getWidgetTelemetryEvents();
    assert.equal(afterEvents.length >= before, true);
    const last = afterEvents[afterEvents.length - 1];
    assert.equal(last?.event, 'widget_parse');
    assert.equal(typeof last?.at, 'string');
    assert.equal(last?.schemaVersion, '1.0');
    assert.equal(typeof last?.traceId, 'string');
  });

  it('deduplicates identical events inside dedupe window', () => {
    const before = getWidgetTelemetryEvents().length;
    const dedupeKey = `test-dedupe-${Date.now()}`;
    publishWidgetTelemetry({
      event: 'widget_parse',
      ok: true,
      dedupeKey,
      dedupeWindowMs: 60_000,
    });
    publishWidgetTelemetry({
      event: 'widget_parse',
      ok: true,
      dedupeKey,
      dedupeWindowMs: 60_000,
    });
    const after = getWidgetTelemetryEvents().length;
    assert.equal(after - before, 1);
  });
});
