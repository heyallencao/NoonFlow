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

const GLOBAL_WIDGET_TELEMETRY_KEY = '__noonflowWidgetTelemetryEvents__' as const;
const GLOBAL_WIDGET_PENDING_KEY = '__noonflowWidgetTelemetryPending__' as const;
const GLOBAL_WIDGET_FLUSHING_KEY = '__noonflowWidgetTelemetryFlushing__' as const;
const GLOBAL_WIDGET_FLUSH_TIMER_KEY = '__noonflowWidgetTelemetryFlushTimer__' as const;
const GLOBAL_WIDGET_DEDUPE_CACHE_KEY = '__noonflowWidgetTelemetryDedupeCache__' as const;
const MAX_WIDGET_TELEMETRY_EVENTS = 200;
const MAX_WIDGET_TELEMETRY_BATCH_SIZE = 40;
const WIDGET_TELEMETRY_FLUSH_DELAY_MS = 1200;
const MAX_WIDGET_TELEMETRY_DEDUPE_KEYS = 2000;
const DEFAULT_WIDGET_TELEMETRY_DEDUPE_WINDOW_MS = 8_000;
const MAX_WIDGET_TELEMETRY_DEDUPE_WINDOW_MS = 60_000;

function randomHex(length: number): string {
  const alphabet = '0123456789abcdef';
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function createWidgetTraceId(seed?: string): string {
  const seedPart = (seed || '').trim().slice(0, 16).replace(/\s+/g, '_');
  const nonce = randomHex(8);
  const ts = Date.now().toString(36);
  return seedPart ? `w_${seedPart}_${ts}_${nonce}` : `w_${ts}_${nonce}`;
}

function pushWidgetTelemetryEvent(event: WidgetTelemetryEnvelope): void {
  const globalObject = globalThis as Record<string, unknown>;
  const current = Array.isArray(globalObject[GLOBAL_WIDGET_TELEMETRY_KEY])
    ? (globalObject[GLOBAL_WIDGET_TELEMETRY_KEY] as WidgetTelemetryEnvelope[])
    : [];
  current.push(event);
  if (current.length > MAX_WIDGET_TELEMETRY_EVENTS) {
    current.splice(0, current.length - MAX_WIDGET_TELEMETRY_EVENTS);
  }
  globalObject[GLOBAL_WIDGET_TELEMETRY_KEY] = current;
}

function getWidgetTelemetryPendingQueue(): WidgetTelemetryEnvelope[] {
  const globalObject = globalThis as Record<string, unknown>;
  const queue = globalObject[GLOBAL_WIDGET_PENDING_KEY];
  if (Array.isArray(queue)) {
    return queue as WidgetTelemetryEnvelope[];
  }
  const nextQueue: WidgetTelemetryEnvelope[] = [];
  globalObject[GLOBAL_WIDGET_PENDING_KEY] = nextQueue;
  return nextQueue;
}

function clearWidgetTelemetryFlushTimer(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const globalObject = globalThis as Record<string, unknown>;
  const timer = globalObject[GLOBAL_WIDGET_FLUSH_TIMER_KEY];
  if (typeof timer === 'number') {
    window.clearTimeout(timer);
  }
  globalObject[GLOBAL_WIDGET_FLUSH_TIMER_KEY] = null;
}

function scheduleWidgetTelemetryFlush(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const globalObject = globalThis as Record<string, unknown>;
  if (globalObject[GLOBAL_WIDGET_FLUSHING_KEY] === true) {
    return;
  }
  if (typeof globalObject[GLOBAL_WIDGET_FLUSH_TIMER_KEY] === 'number') {
    return;
  }
  const timerId = window.setTimeout(() => {
    clearWidgetTelemetryFlushTimer();
    void flushWidgetTelemetryQueue();
  }, WIDGET_TELEMETRY_FLUSH_DELAY_MS);
  globalObject[GLOBAL_WIDGET_FLUSH_TIMER_KEY] = timerId;
}

export async function flushWidgetTelemetryQueue(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }
  const globalObject = globalThis as Record<string, unknown>;
  if (globalObject[GLOBAL_WIDGET_FLUSHING_KEY] === true) {
    return;
  }

  const queue = getWidgetTelemetryPendingQueue();
  if (queue.length === 0) {
    return;
  }

  globalObject[GLOBAL_WIDGET_FLUSHING_KEY] = true;
  try {
    while (queue.length > 0) {
      const batch = queue.slice(0, MAX_WIDGET_TELEMETRY_BATCH_SIZE);
      const response = await fetch('/api/widget/telemetry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: batch }),
      });
      if (!response.ok) {
        break;
      }
      queue.splice(0, batch.length);
    }
  } catch {
    // Best effort telemetry transport. Keep pending queue for retry.
  } finally {
    globalObject[GLOBAL_WIDGET_FLUSHING_KEY] = false;
    if (queue.length > 0) {
      scheduleWidgetTelemetryFlush();
    }
  }
}

export function getWidgetTelemetryEvents(): WidgetTelemetryEnvelope[] {
  const globalObject = globalThis as Record<string, unknown>;
  const current = globalObject[GLOBAL_WIDGET_TELEMETRY_KEY];
  if (!Array.isArray(current)) {
    return [];
  }
  return current as WidgetTelemetryEnvelope[];
}

function getWidgetTelemetryDedupeCache(): Map<string, number> {
  const globalObject = globalThis as Record<string, unknown>;
  const cache = globalObject[GLOBAL_WIDGET_DEDUPE_CACHE_KEY];
  if (cache instanceof Map) {
    return cache as Map<string, number>;
  }
  const next = new Map<string, number>();
  globalObject[GLOBAL_WIDGET_DEDUPE_CACHE_KEY] = next;
  return next;
}

function shouldSkipWidgetTelemetryEvent(event: WidgetTelemetryEvent): boolean {
  const dedupeKey = event.dedupeKey?.trim();
  if (!dedupeKey) {
    return false;
  }

  const rawWindow = typeof event.dedupeWindowMs === 'number' ? event.dedupeWindowMs : DEFAULT_WIDGET_TELEMETRY_DEDUPE_WINDOW_MS;
  const dedupeWindowMs = Math.min(
    Math.max(Math.trunc(rawWindow), 1),
    MAX_WIDGET_TELEMETRY_DEDUPE_WINDOW_MS,
  );
  const now = Date.now();
  const cache = getWidgetTelemetryDedupeCache();
  const previous = cache.get(dedupeKey);
  if (typeof previous === 'number' && now - previous < dedupeWindowMs) {
    return true;
  }

  cache.set(dedupeKey, now);
  while (cache.size > MAX_WIDGET_TELEMETRY_DEDUPE_KEYS) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    cache.delete(oldest);
  }
  return false;
}

export function publishWidgetTelemetry(event: WidgetTelemetryEvent): void {
  if (shouldSkipWidgetTelemetryEvent(event)) {
    return;
  }
  const envelope: WidgetTelemetryEnvelope = {
    event: event.event,
    ok: event.ok,
    code: event.code,
    runtime: event.runtime,
    sessionId: event.sessionId,
    messageId: event.messageId,
    traceId: event.traceId || createWidgetTraceId(),
    schemaVersion: event.schemaVersion || '1.0',
    meta: event.meta,
    at: new Date().toISOString(),
  };
  pushWidgetTelemetryEvent(envelope);

  if (typeof window !== 'undefined') {
    const queue = getWidgetTelemetryPendingQueue();
    queue.push(envelope);
    if (queue.length > 500) {
      queue.splice(0, queue.length - 500);
    }
    scheduleWidgetTelemetryFlush();
    window.dispatchEvent(new CustomEvent<WidgetTelemetryEnvelope>('noonflow:widget-telemetry', {
      detail: envelope,
    }));
  }
}
