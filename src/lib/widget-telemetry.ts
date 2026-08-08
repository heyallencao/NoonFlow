export type WidgetTelemetryEventName =
  | 'widget_parse'
  | 'widget_compile'
  | 'widget_sanitize'
  | 'widget_render'
  | 'widget_recover';

export const WIDGET_TELEMETRY_ERROR_CODES = [
  'W_PARSE_INCOMPLETE_FENCE',
  'W_PARSE_MALFORMED_PAYLOAD',
  'W_PARSE_EMPTY_PAYLOAD',
  'W_COMPILE_UNSUPPORTED_INPUT',
  'W_COMPILE_TEMPLATE_UNSUPPORTED',
  'W_COMPILE_EMPTY_DATA',
  'W_SECURITY_PAYLOAD_REWRITTEN',
  'W_RENDER_IFRAME_LOADED',
  'W_RENDER_IFRAME_TIMEOUT',
  'W_RENDER_BOUNDARY_ERROR',
  'W_RECOVER_TEXT_FALLBACK',
  'W_RECOVER_PAYLOAD_REPAIRED',
] as const;

export type WidgetTelemetryErrorCode = (typeof WIDGET_TELEMETRY_ERROR_CODES)[number];

export function isWidgetTelemetryErrorCode(value: unknown): value is WidgetTelemetryErrorCode {
  return typeof value === 'string'
    && (WIDGET_TELEMETRY_ERROR_CODES as readonly string[]).includes(value);
}

export interface WidgetTelemetryEvent {
  event: WidgetTelemetryEventName;
  ok: boolean;
  code?: WidgetTelemetryErrorCode;
  runtime?: string;
  sessionId?: string;
  messageId?: string;
  traceId?: string;
  schemaVersion?: string;
  meta?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindowMs?: number;
}

interface WidgetTelemetryEnvelope extends WidgetTelemetryEvent {
  at: string;
}

const events: WidgetTelemetryEnvelope[] = [];
const dedupe = new Map<string, number>();

export function createWidgetTraceId(seed?: string): string {
  const prefix = (seed || '').trim().slice(0, 16).replace(/\s+/g, '_');
  const suffix = Math.random().toString(16).slice(2, 10);
  return prefix ? `w_${prefix}_${suffix}` : `w_${suffix}`;
}

export function getWidgetTelemetryEvents(): WidgetTelemetryEnvelope[] {
  return [...events];
}

export async function flushWidgetTelemetryQueue(): Promise<void> {
  // Widget diagnostics are process-local only. NoonFlow no longer transports
  // or persists its own telemetry.
}

export function publishWidgetTelemetry(event: WidgetTelemetryEvent): void {
  const now = Date.now();
  const key = event.dedupeKey?.trim();
  if (key) {
    const windowMs = Math.min(Math.max(event.dedupeWindowMs || 8_000, 1), 60_000);
    const previous = dedupe.get(key);
    if (previous && now - previous < windowMs) return;
    dedupe.set(key, now);
  }

  const envelope: WidgetTelemetryEnvelope = {
    ...event,
    traceId: event.traceId || createWidgetTraceId(),
    schemaVersion: event.schemaVersion || '1.0',
    at: new Date(now).toISOString(),
  };
  events.push(envelope);
  if (events.length > 200) events.splice(0, events.length - 200);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<WidgetTelemetryEnvelope>('noonflow:widget-telemetry', {
      detail: envelope,
    }));
  }
}
