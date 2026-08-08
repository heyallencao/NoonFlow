import { createWidgetTraceId, type WidgetTelemetryEvent } from './widget-telemetry';

interface WidgetBoundaryTelemetryContext {
  traceId?: string;
  runtime?: string;
  sessionId?: string;
  messageId?: string;
}

function getErrorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}

export function buildWidgetRecoverFallbackEvent(
  error: unknown,
  context: WidgetBoundaryTelemetryContext,
): WidgetTelemetryEvent {
  return {
    event: 'widget_recover',
    ok: false,
    code: 'W_RECOVER_TEXT_FALLBACK',
    traceId: context.traceId || createWidgetTraceId('recover_boundary'),
    runtime: context.runtime,
    sessionId: context.sessionId,
    messageId: context.messageId,
    meta: {
      reason: getErrorReason(error),
    },
  };
}

export function buildWidgetRenderBoundaryErrorEvent(
  error: unknown,
  context: WidgetBoundaryTelemetryContext,
): WidgetTelemetryEvent {
  return {
    event: 'widget_render',
    ok: false,
    code: 'W_RENDER_BOUNDARY_ERROR',
    traceId: context.traceId || createWidgetTraceId('render_boundary'),
    runtime: context.runtime,
    sessionId: context.sessionId,
    messageId: context.messageId,
    meta: {
      reason: getErrorReason(error),
    },
  };
}
