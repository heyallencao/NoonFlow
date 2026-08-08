import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelemetryCreatedAt, parseTelemetryCreatedAt } from '../../lib/widget-telemetry-time';

describe('widget telemetry timestamp normalization', () => {
  it('accepts sane client timestamp', () => {
    const now = Date.parse('2026-03-23T12:00:00.000Z');
    const normalized = normalizeTelemetryCreatedAt('2026-03-23T11:59:30.000Z', now);
    assert.equal(normalized, '2026-03-23 11:59:30');
  });

  it('preserves timezone-less utc-style timestamps without local timezone drift', () => {
    const now = Date.parse('2026-03-23T12:30:00.000Z');
    const normalized = normalizeTelemetryCreatedAt('2026-03-23 12:00:00', now);
    assert.equal(normalized, '2026-03-23 12:00:00');
  });

  it('parses timezone-less utc-style timestamps as utc instants', () => {
    const parsed = parseTelemetryCreatedAt('2026-03-23 12:00:00');
    assert.equal(parsed?.toISOString(), '2026-03-23T12:00:00.000Z');
  });

  it('rejects far-future timestamp', () => {
    const now = Date.parse('2026-03-23T12:00:00.000Z');
    const normalized = normalizeTelemetryCreatedAt('2026-03-23T12:10:01.000Z', now);
    assert.equal(normalized, undefined);
  });

  it('rejects too-old timestamp', () => {
    const now = Date.parse('2026-03-23T12:00:00.000Z');
    const normalized = normalizeTelemetryCreatedAt('2025-11-20T12:00:00.000Z', now);
    assert.equal(normalized, undefined);
  });
});
