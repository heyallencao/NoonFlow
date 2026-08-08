import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WIDGET_TELEMETRY_THRESHOLDS,
  normalizeWidgetTelemetryThresholds,
  parseWidgetTelemetryThresholds,
  serializeWidgetTelemetryThresholds,
} from '../../lib/widget-telemetry-thresholds';

describe('widget telemetry thresholds', () => {
  it('uses defaults when settings are empty or invalid', () => {
    assert.deepEqual(parseWidgetTelemetryThresholds(''), DEFAULT_WIDGET_TELEMETRY_THRESHOLDS);
    assert.deepEqual(parseWidgetTelemetryThresholds('not-json'), DEFAULT_WIDGET_TELEMETRY_THRESHOLDS);
  });

  it('normalizes out-of-range values', () => {
    const normalized = normalizeWidgetTelemetryThresholds({
      minEvents: -5,
      errorRateWarning: 2,
      errorRateCritical: 1.5,
      fallbackRateWarning: -1,
      fallbackRateCritical: 10,
      renderErrorRateWarning: 0.9,
      renderErrorRateCritical: 0.4,
    });

    assert.equal(normalized.minEvents, 1);
    assert.equal(normalized.errorRateCritical, 1);
    assert.equal(normalized.fallbackRateWarning, 0);
    assert.equal(normalized.fallbackRateCritical, 1);
    assert.equal(normalized.renderErrorRateCritical, 0.4);
    assert.equal(normalized.renderErrorRateWarning < normalized.renderErrorRateCritical, true);
  });

  it('round-trips with serialize + parse', () => {
    const serialized = serializeWidgetTelemetryThresholds({
      minEvents: 33,
      errorRateWarning: 0.05,
      errorRateCritical: 0.17,
      fallbackRateWarning: 0.02,
      fallbackRateCritical: 0.09,
      renderErrorRateWarning: 0.07,
      renderErrorRateCritical: 0.21,
    });
    const parsed = parseWidgetTelemetryThresholds(serialized);

    assert.equal(parsed.minEvents, 33);
    assert.equal(parsed.errorRateWarning, 0.05);
    assert.equal(parsed.errorRateCritical, 0.17);
    assert.equal(parsed.fallbackRateWarning, 0.02);
    assert.equal(parsed.fallbackRateCritical, 0.09);
    assert.equal(parsed.renderErrorRateWarning, 0.07);
    assert.equal(parsed.renderErrorRateCritical, 0.21);
  });
});
