'use client';

import { Component, type ReactNode } from 'react';
import { publishWidgetTelemetry } from '@/lib/widget-telemetry';
import {
  buildWidgetRecoverFallbackEvent,
  buildWidgetRenderBoundaryErrorEvent,
} from '@/lib/widget-error-boundary-telemetry';

interface WidgetErrorBoundaryProps {
  children: ReactNode;
  fallbackLabel: string;
  sessionId?: string;
  messageId?: string;
  runtime?: string;
  traceId?: string;
}

interface WidgetErrorBoundaryState {
  hasError: boolean;
}

export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  state: WidgetErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): WidgetErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[widget] render failed', error);
    const context = {
      traceId: this.props.traceId,
      runtime: this.props.runtime,
      sessionId: this.props.sessionId,
      messageId: this.props.messageId,
    };
    publishWidgetTelemetry(buildWidgetRecoverFallbackEvent(error, context));
    publishWidgetTelemetry(buildWidgetRenderBoundaryErrorEvent(error, context));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-3 text-xs text-muted-foreground">
          {this.props.fallbackLabel}
        </div>
      );
    }
    return this.props.children;
  }
}
