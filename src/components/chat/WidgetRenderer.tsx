'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildReceiverSrcdoc } from '@/lib/widget-css-bridge';
import { openExternalLink } from '@/lib/external-links';
import { getCachedWidgetHeight, setCachedWidgetHeight } from '@/lib/widget-frame-cache';
import { sanitizeForStreaming } from '@/lib/widget-sanitizer';
import { createWidgetTraceId, publishWidgetTelemetry } from '@/lib/widget-telemetry';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    __widgetSendMessage?: (content: string) => void;
  }
}

interface WidgetRendererProps {
  widgetKey: string;
  widgetCode: string;
  title?: string;
  isStreaming?: boolean;
  sessionId?: string;
  messageId?: string;
  runtime?: string;
  traceId?: string;
  className?: string;
}

interface WidgetBridgeMessage {
  source?: string;
  bridgeToken?: string;
  type?: 'resize' | 'link' | 'ask';
  height?: number;
  href?: string;
  content?: string;
}

const MIN_FRAME_HEIGHT = 140;
const MAX_FRAME_HEIGHT = 1800;

function createBridgeToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return `widget-${bytes[0].toString(16)}${bytes[1].toString(16)}`;
  }
  return `widget-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function clampFrameHeight(height: number): number {
  if (!Number.isFinite(height)) return MIN_FRAME_HEIGHT;
  if (height < MIN_FRAME_HEIGHT) return MIN_FRAME_HEIGHT;
  if (height > MAX_FRAME_HEIGHT) return MAX_FRAME_HEIGHT;
  return Math.ceil(height);
}

export function WidgetRenderer({
  widgetKey,
  widgetCode,
  title,
  isStreaming = false,
  sessionId,
  messageId,
  runtime,
  traceId,
  className,
}: WidgetRendererProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(() => getCachedWidgetHeight(widgetKey) ?? 260);
  const [loadedSrcDoc, setLoadedSrcDoc] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const reportedTimeoutRef = useRef<boolean>(false);
  const bridgeToken = useMemo(() => `${widgetKey}:${createBridgeToken()}`, [widgetKey]);
  const telemetryTraceId = useMemo(() => traceId || createWidgetTraceId(widgetKey), [traceId, widgetKey]);

  const sanitizedCode = useMemo(
    () => (isStreaming ? sanitizeForStreaming(widgetCode) : widgetCode),
    [isStreaming, widgetCode],
  );

  const srcDoc = useMemo(
    () => buildReceiverSrcdoc({
      html: sanitizedCode,
      title,
      bridgeToken,
    }),
    [bridgeToken, sanitizedCode, title],
  );
  const loaded = loadedSrcDoc === srcDoc;
  const handleFrameLoad = useCallback(() => {
    setLoadedSrcDoc(srcDoc);
    publishWidgetTelemetry({
      event: 'widget_render',
      ok: true,
      code: 'W_RENDER_IFRAME_LOADED',
      traceId: telemetryTraceId,
      runtime,
      sessionId,
      messageId,
      meta: {
        widgetKey,
        isStreaming,
        title: title || '',
      },
    });
  }, [isStreaming, messageId, runtime, sessionId, srcDoc, telemetryTraceId, title, widgetKey]);

  useEffect(() => {
    if (loaded) {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      reportedTimeoutRef.current = false;
      return;
    }

    if (timeoutRef.current || reportedTimeoutRef.current) {
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      reportedTimeoutRef.current = true;
      timeoutRef.current = null;
      publishWidgetTelemetry({
        event: 'widget_render',
        ok: false,
        code: 'W_RENDER_IFRAME_TIMEOUT',
        traceId: telemetryTraceId,
        runtime,
        sessionId,
        messageId,
        meta: {
          widgetKey,
          isStreaming,
          title: title || '',
        },
      });
    }, 8000);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isStreaming, loaded, messageId, runtime, sessionId, telemetryTraceId, title, widgetKey]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<WidgetBridgeMessage>) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      const data = event.data;
      if (
        !data
        || (data.source !== 'noonflow-widget' && data.source !== 'monolith-widget')
        || data.bridgeToken !== bridgeToken
      ) {
        return;
      }
      if (data.type === 'resize') {
        const nextHeight = clampFrameHeight(Number(data.height || 0));
        setFrameHeight(nextHeight);
        setCachedWidgetHeight(widgetKey, nextHeight);
        return;
      }
      if (data.type === 'link' && typeof data.href === 'string' && data.href.trim()) {
        void openExternalLink(data.href);
        return;
      }
      if (data.type === 'ask' && typeof data.content === 'string') {
        const askContent = data.content.trim().slice(0, 1000);
        if (!askContent) return;
        window.__widgetSendMessage?.(askContent);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [bridgeToken, widgetKey]);

  return (
    <div
      className={cn('group relative overflow-hidden rounded-xl border border-border-subtle bg-bg-primary/70', className)}
      data-widget-container="true"
      data-widget-key={widgetKey}
    >
      {title && (
        <div className="border-b border-border-subtle/80 bg-bg-secondary/55 px-3 py-2">
          <p className="truncate text-[11px] font-medium tracking-wide text-muted-foreground">
            {title}
          </p>
        </div>
      )}

      <div className="relative">
        {!loaded && (
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              background:
                'linear-gradient(90deg, rgba(116,139,255,0.10) 0%, rgba(116,139,255,0.24) 50%, rgba(116,139,255,0.10) 100%)',
              backgroundSize: '200% 100%',
              animation: 'widget-shimmer 1.6s linear infinite',
            }}
          />
        )}
        <iframe
          ref={frameRef}
          title={title || 'Generated widget'}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="block w-full border-0 bg-transparent"
          data-widget-iframe="true"
          style={{ height: `${frameHeight}px` }}
          onLoad={handleFrameLoad}
        />
      </div>
    </div>
  );
}
