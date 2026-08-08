import { NextRequest } from 'next/server';
import { getWidgetTelemetryStats, recordWidgetTelemetryEvents, type WidgetTelemetryPersistEvent } from '@/lib/db';
import { isWidgetTelemetryErrorCode } from '@/lib/widget-telemetry';
import { normalizeTelemetryCreatedAt } from '@/lib/widget-telemetry-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WIDGET_EVENTS = new Set([
  'widget_parse',
  'widget_compile',
  'widget_sanitize',
  'widget_render',
  'widget_recover',
]);

function toWidgetTelemetryEvent(raw: unknown): WidgetTelemetryPersistEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const event = typeof value.event === 'string' ? value.event : '';
  if (!WIDGET_EVENTS.has(event)) {
    return null;
  }
  return {
    event: event as WidgetTelemetryPersistEvent['event'],
    ok: value.ok !== false,
    code: isWidgetTelemetryErrorCode(value.code) ? value.code : undefined,
    runtime: typeof value.runtime === 'string' ? value.runtime : undefined,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
    traceId: typeof value.traceId === 'string' ? value.traceId : undefined,
    schemaVersion: typeof value.schemaVersion === 'string' ? value.schemaVersion : undefined,
    meta: value.meta && typeof value.meta === 'object' && !Array.isArray(value.meta)
      ? (value.meta as Record<string, unknown>)
      : undefined,
    createdAt: normalizeTelemetryCreatedAt(value.at),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { events?: unknown[] };
    const rawEvents = Array.isArray(body?.events) ? body.events : [];
    const normalizedEvents = rawEvents
      .map(toWidgetTelemetryEvent)
      .filter((event): event is WidgetTelemetryPersistEvent => Boolean(event));

    if (normalizedEvents.length === 0) {
      return Response.json({ ok: true, inserted: 0 });
    }

    const inserted = recordWidgetTelemetryEvents(normalizedEvents);
    return Response.json({ ok: true, inserted });
  } catch (error) {
    console.error('[widget/telemetry] POST error:', error);
    return Response.json({ ok: false, error: 'Failed to ingest widget telemetry' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const daysParam = request.nextUrl.searchParams.get('days');
    const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 7, 1), 90) : 7;
    const stats = getWidgetTelemetryStats(days);
    return Response.json(stats);
  } catch (error) {
    console.error('[widget/telemetry] GET error:', error);
    return Response.json({ error: 'Failed to query widget telemetry' }, { status: 500 });
  }
}
