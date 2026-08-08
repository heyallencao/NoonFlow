export interface WidgetTelemetryThresholds {
  minEvents: number;
  errorRateWarning: number;
  errorRateCritical: number;
  fallbackRateWarning: number;
  fallbackRateCritical: number;
  renderErrorRateWarning: number;
  renderErrorRateCritical: number;
}

export const DEFAULT_WIDGET_TELEMETRY_THRESHOLDS: WidgetTelemetryThresholds = {
  minEvents: 20,
  errorRateWarning: 0.06,
  errorRateCritical: 0.15,
  fallbackRateWarning: 0.03,
  fallbackRateCritical: 0.08,
  renderErrorRateWarning: 0.08,
  renderErrorRateCritical: 0.18,
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clampRate(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampMinEvents(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5000) return 5000;
  return rounded;
}

export function normalizeWidgetTelemetryThresholds(
  raw: Partial<WidgetTelemetryThresholds> | null | undefined,
): WidgetTelemetryThresholds {
  const base = DEFAULT_WIDGET_TELEMETRY_THRESHOLDS;
  const normalized: WidgetTelemetryThresholds = {
    minEvents: clampMinEvents(toFiniteNumber(raw?.minEvents) ?? base.minEvents, base.minEvents),
    errorRateWarning: clampRate(toFiniteNumber(raw?.errorRateWarning) ?? base.errorRateWarning, base.errorRateWarning),
    errorRateCritical: clampRate(toFiniteNumber(raw?.errorRateCritical) ?? base.errorRateCritical, base.errorRateCritical),
    fallbackRateWarning: clampRate(toFiniteNumber(raw?.fallbackRateWarning) ?? base.fallbackRateWarning, base.fallbackRateWarning),
    fallbackRateCritical: clampRate(toFiniteNumber(raw?.fallbackRateCritical) ?? base.fallbackRateCritical, base.fallbackRateCritical),
    renderErrorRateWarning: clampRate(toFiniteNumber(raw?.renderErrorRateWarning) ?? base.renderErrorRateWarning, base.renderErrorRateWarning),
    renderErrorRateCritical: clampRate(toFiniteNumber(raw?.renderErrorRateCritical) ?? base.renderErrorRateCritical, base.renderErrorRateCritical),
  };

  if (normalized.errorRateWarning >= normalized.errorRateCritical) {
    normalized.errorRateWarning = Math.max(0, normalized.errorRateCritical * 0.6);
  }
  if (normalized.fallbackRateWarning >= normalized.fallbackRateCritical) {
    normalized.fallbackRateWarning = Math.max(0, normalized.fallbackRateCritical * 0.6);
  }
  if (normalized.renderErrorRateWarning >= normalized.renderErrorRateCritical) {
    normalized.renderErrorRateWarning = Math.max(0, normalized.renderErrorRateCritical * 0.6);
  }

  return normalized;
}

export function parseWidgetTelemetryThresholds(raw: string | null | undefined): WidgetTelemetryThresholds {
  if (!raw) {
    return DEFAULT_WIDGET_TELEMETRY_THRESHOLDS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WidgetTelemetryThresholds>;
    return normalizeWidgetTelemetryThresholds(parsed);
  } catch {
    return DEFAULT_WIDGET_TELEMETRY_THRESHOLDS;
  }
}

export function serializeWidgetTelemetryThresholds(value: WidgetTelemetryThresholds): string {
  return JSON.stringify(normalizeWidgetTelemetryThresholds(value));
}
