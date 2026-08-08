import { compileDeclarativeWidgetPayload, compileTabularWidgetFence } from './widget-compiler';
import { payloadLooksLikeJsonWidgetCandidate } from './widget-schema';
import { createWidgetTraceId, publishWidgetTelemetry } from './widget-telemetry';

export interface ShowWidgetPayload {
  title: string;
  widget_code: string;
}

export type ShowWidgetPart =
  | { type: 'text'; text: string }
  | { type: 'widget'; title: string; widgetCode: string; key: string };

export interface ShowWidgetRenderPlan {
  parts: ShowWidgetPart[];
  hasIncompleteWidget: boolean;
  hasMalformedWidget: boolean;
  widgetCount: number;
}

const CODE_FENCE_RE = /```([a-zA-Z0-9_-]+)[^\n]*\n?([\s\S]*?)\n?```/g;
const EXPLICIT_WIDGET_FENCE_RE = /```(?:show-widget|widget-dashboard|widget-json|widget-ui|widget-table|widget-csv|widget-tsv)\b/i;
const DECLARATIVE_JSON_FENCE_HINT_RE =
  /```json[\t ]*\n[\s\S]{0,2400}"(?:sections|layout|widgets|template|chart|encoding|actions|theme|ariaLabel|aria-label)"[\s\S]*?```/i;
const DECLARATIVE_JSON_HINT_RE = /"(?:sections|layout|widgets|template|chart|encoding|actions|theme|ariaLabel|aria-label)"/i;

// Safety limit to prevent ReDoS on malformed input
const MAX_REGEX_INPUT_LENGTH = 500_000;

const EXPLICIT_WIDGET_FENCE_LANGUAGES = new Set([
  'show-widget',
  'widget-dashboard',
  'widget-json',
  'widget-ui',
  'widget-table',
  'widget-csv',
  'widget-tsv',
]);

const TABULAR_WIDGET_LANGUAGE_KIND: Record<string, 'table' | 'csv' | 'tsv'> = {
  'widget-table': 'table',
  'widget-csv': 'csv',
  'widget-tsv': 'tsv',
};

const DEFAULT_MAX_WIDGET_LENGTH = 30_000;
const URL_ATTR_RE = /(\b(?:href|src|xlink:href|action|formaction)\s*=\s*)(["'])([\s\S]*?)\2|(\b(?:href|src|xlink:href|action|formaction)\s*=\s*)([^\s"'`>]+)/gi;

interface ParsedWidgetPartsResult {
  parts: ShowWidgetPart[];
  widgetCount: number;
  recognizedFenceCount: number;
  recoveredFenceCount: number;
  recoveryFailureCount: number;
}

interface ParseWidgetFenceResult {
  payload: ShowWidgetPayload | null;
  recognized: boolean;
  recovered: boolean;
  recoveryAttempted: boolean;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeWidgetPayload(payload: unknown): ShowWidgetPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const title = String(record.title || '').trim();
  const widgetCode = String(record.widget_code || '');
  if (!widgetCode.trim()) {
    return null;
  }
  return {
    title: title || 'generated_widget',
    widget_code: widgetCode,
  };
}

function parseLooseJson(rawPayload: string): unknown {
  const normalized = rawPayload.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      const repaired = normalized.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function parseWidgetPayload(rawPayload: string): ShowWidgetPayload | null {
  return normalizeWidgetPayload(parseLooseJson(rawPayload));
}

function decodeEscapedWidgetString(rawValue: string): string {
  return rawValue
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function trimTrailingFencePunctuation(value: string): string {
  return value.replace(/[,\s}]+$/g, '').trim();
}

function repairShowWidgetPayload(rawPayload: string): ShowWidgetPayload | null {
  const normalized = rawPayload.trim();
  if (!normalized) {
    return null;
  }

  const title = (
    normalized.match(/["']?title["']?\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1]
    ?? normalized.match(/["']?title["']?\s*:\s*'((?:\\.|[^'\\])*)'/i)?.[1]
    ?? normalized.match(/["']?title["']?\s*:\s*([a-zA-Z0-9 _-]{1,120})\b/i)?.[1]
    ?? 'generated_widget'
  );

  let widgetCode =
    normalized.match(/["']?(?:widget_code|widgetCode)["']?\s*:\s*"((?:\\.|[^"\\])*)"/i)?.[1]
    ?? normalized.match(/["']?(?:widget_code|widgetCode)["']?\s*:\s*'((?:\\.|[^'\\])*)'/i)?.[1]
    ?? '';

  if (widgetCode) {
    widgetCode = decodeEscapedWidgetString(widgetCode).trim();
  } else {
    const unquoted = normalized.match(/["']?(?:widget_code|widgetCode)["']?\s*:\s*([\s\S]+)/i)?.[1] ?? '';
    widgetCode = trimTrailingFencePunctuation(unquoted);
  }

  if (!widgetCode) {
    const htmlFallback = normalized.match(/<(?:svg|div|table|section|article|ul|ol|p|h[1-6]|span|canvas)\b[\s\S]*$/i)?.[0] ?? '';
    widgetCode = trimTrailingFencePunctuation(htmlFallback);
  }

  return normalizeWidgetPayload({
    title: decodeEscapedWidgetString(String(title)),
    widget_code: widgetCode,
  });
}

function sanitizeUrlAttribute(tagName: string, attributeName: string, rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) {
    return value;
  }
  const lower = value.toLowerCase();
  const isAnchorHref = tagName === 'a' && attributeName === 'href';
  const isImageSource =
    (tagName === 'img' && attributeName === 'src')
    || (tagName === 'image' && (attributeName === 'href' || attributeName === 'xlink:href'));

  if (attributeName === 'action' || attributeName === 'formaction') {
    return '#';
  }

  if (isAnchorHref) {
    if (lower.startsWith('#')) {
      return value;
    }
    if (
      lower.startsWith('ask:')
      || lower.startsWith('mailto:')
      || lower.startsWith('tel:')
      || lower.startsWith('http:')
      || lower.startsWith('https:')
    ) {
      return value;
    }
    return '#';
  }

  if (isImageSource) {
    return lower.startsWith('data:image/') ? value : '#';
  }

  // For remaining URL-bearing attributes in sandbox html, deny-by-default.
  return '#';
}

function sanitizeTagUrls(rawHtml: string): string {
  return rawHtml.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?>/g, (match, rawTagName: string, rawAttributes = '') => {
    const tagName = rawTagName.toLowerCase();
    const sanitizedAttributes = rawAttributes.replace(
      URL_ATTR_RE,
      (
        _fullMatch: string,
        quotedPrefix?: string,
        quote?: string,
        quotedUrl?: string,
        unquotedPrefix?: string,
        unquotedUrl?: string,
      ) => {
        const prefix = quotedPrefix || unquotedPrefix || '';
        const url = quotedUrl ?? unquotedUrl ?? '';
        const attributeName = (prefix.trim().split('=')[0] || '').toLowerCase();
        const sanitizedUrl = sanitizeUrlAttribute(tagName, attributeName, url);
        if (quote) {
          return `${prefix}${quote}${sanitizedUrl}${quote}`;
        }
        return `${prefix}${sanitizedUrl}`;
      },
    );

    return `<${rawTagName}${sanitizedAttributes}>`;
  });
}

function sanitizeWidgetHtml(rawHtml: string): string {
  const bounded = rawHtml.slice(0, DEFAULT_MAX_WIDGET_LENGTH);
  const noScriptBlocks = bounded
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style>|$)/gi, '');

  return sanitizeTagUrls(
    noScriptBlocks
      .replace(/<\/?(?:iframe|object|embed|base|meta|link|style|form|input|textarea|select|option|button)\b[^>]*>/gi, '')
      .replace(/\sstyle\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
      .replace(/\ssrcdoc\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, ''),
  )
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .trim();
}

function mergeAdjacentTextParts(parts: ShowWidgetPart[]): ShowWidgetPart[] {
  if (parts.length <= 1) {
    return parts;
  }
  const merged: ShowWidgetPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.type === 'text' && last?.type === 'text') {
      last.text += part.text;
      continue;
    }
    merged.push(part);
  }
  return merged;
}

function parseWidgetFencePayload(language: string, rawPayload: string): ParseWidgetFenceResult {
  const normalizedLanguage = language.toLowerCase();

  if (normalizedLanguage === 'show-widget') {
    const parsed = parseWidgetPayload(rawPayload);
    if (parsed) {
      return {
        payload: parsed,
        recognized: true,
        recovered: false,
        recoveryAttempted: false,
      };
    }
    const repaired = repairShowWidgetPayload(rawPayload);
    return {
      payload: repaired,
      recognized: true,
      recovered: Boolean(repaired),
      recoveryAttempted: true,
    };
  }

  if (normalizedLanguage === 'widget-dashboard' || normalizedLanguage === 'widget-json' || normalizedLanguage === 'widget-ui') {
    return {
      payload: compileDeclarativeWidgetPayload(rawPayload),
      recognized: true,
      recovered: false,
      recoveryAttempted: false,
    };
  }

  const tabularKind = TABULAR_WIDGET_LANGUAGE_KIND[normalizedLanguage];
  if (tabularKind) {
    return {
      payload: compileTabularWidgetFence(tabularKind, rawPayload),
      recognized: true,
      recovered: false,
      recoveryAttempted: false,
    };
  }

  if (normalizedLanguage === 'json') {
    const parsed = parseLooseJson(rawPayload);
    if (!payloadLooksLikeJsonWidgetCandidate(parsed)) {
      return {
        payload: null,
        recognized: false,
        recovered: false,
        recoveryAttempted: false,
      };
    }
    return {
      payload: compileDeclarativeWidgetPayload(parsed),
      recognized: true,
      recovered: false,
      recoveryAttempted: false,
    };
  }

  return {
    payload: null,
    recognized: false,
    recovered: false,
    recoveryAttempted: false,
  };
}

function parseWidgetParts(text: string): ParsedWidgetPartsResult {
  if (!text || text.length > MAX_REGEX_INPUT_LENGTH) {
    return {
      parts: text ? [{ type: 'text', text: text.slice(0, MAX_REGEX_INPUT_LENGTH) }] : [],
      widgetCount: 0,
      recognizedFenceCount: 0,
      recoveredFenceCount: 0,
      recoveryFailureCount: 0,
    };
  }

  const parts: ShowWidgetPart[] = [];
  let cursor = 0;
  let widgetCounter = 0;
  let recognizedFenceCount = 0;
  let recoveredFenceCount = 0;
  let recoveryFailureCount = 0;
  CODE_FENCE_RE.lastIndex = 0;

  while (true) {
    const match = CODE_FENCE_RE.exec(text);
    if (!match) {
      break;
    }

    const start = match.index;
    const end = start + match[0].length;
    const language = (match[1] || '').toLowerCase();
    const rawPayload = match[2] || '';
    if (start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, start) });
    }

    const parsed = parseWidgetFencePayload(language, rawPayload);
    if (parsed.recognized) {
      recognizedFenceCount += 1;
      if (parsed.recovered) {
        recoveredFenceCount += 1;
      }
      if (parsed.recoveryAttempted && !parsed.payload) {
        recoveryFailureCount += 1;
      }
    }

    if (!parsed.payload) {
      parts.push({ type: 'text', text: match[0] });
    } else {
      widgetCounter += 1;
      const keySeed = `${widgetCounter}|${parsed.payload.title}`;
      parts.push({
        type: 'widget',
        title: parsed.payload.title,
        widgetCode: parsed.payload.widget_code,
        key: computePartialWidgetKey(keySeed),
      });
    }
    cursor = end;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) });
  }

  const merged = mergeAdjacentTextParts(parts);
  const widgetCount = merged.filter((part) => part.type === 'widget').length;
  return {
    parts: merged,
    widgetCount,
    recognizedFenceCount,
    recoveredFenceCount,
    recoveryFailureCount,
  };
}

function stripTrailingIncompleteFenceWithMatcher(
  text: string,
  matcher: (language: string, trailingContent: string) => boolean,
): { text: string; hasIncompleteWidget: boolean } {
  if (!text) {
    return { text, hasIncompleteWidget: false };
  }

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const openIndex = text.indexOf('```', searchFrom);
    if (openIndex < 0) {
      break;
    }

    const lineEnd = text.indexOf('\n', openIndex + 3);
    const headerEnd = lineEnd >= 0 ? lineEnd : text.length;
    const header = text.slice(openIndex + 3, headerEnd).trim();
    const language = header.split(/\s+/)[0]?.toLowerCase() || '';
    const trailingContent = text.slice(headerEnd + (lineEnd >= 0 ? 1 : 0));
    const closeIndex = text.indexOf('```', headerEnd + (lineEnd >= 0 ? 1 : 0));

    if (language && closeIndex < 0 && matcher(language, trailingContent)) {
      return {
        text: text.slice(0, openIndex).trimEnd(),
        hasIncompleteWidget: true,
      };
    }

    if (closeIndex >= 0) {
      searchFrom = closeIndex + 3;
      continue;
    }
    searchFrom = openIndex + 3;
  }

  return { text, hasIncompleteWidget: false };
}

function isPotentialIncompleteWidgetFence(language: string, trailingContent: string): boolean {
  if (EXPLICIT_WIDGET_FENCE_LANGUAGES.has(language)) {
    return true;
  }
  if (language === 'json') {
    const snippet = trailingContent.slice(0, 2000);
    return DECLARATIVE_JSON_HINT_RE.test(snippet);
  }
  return false;
}

export function computePartialWidgetKey(rawText: string): string {
  const normalized = rawText.trim();
  if (!normalized) {
    return 'widget-empty';
  }
  return `widget-${hashText(normalized.slice(0, 2000))}`;
}

export function hasWidgetProtocolCandidate(text: string): boolean {
  if (!text || text.length > MAX_REGEX_INPUT_LENGTH) {
    return false;
  }
  if (EXPLICIT_WIDGET_FENCE_RE.test(text)) {
    return true;
  }

  CODE_FENCE_RE.lastIndex = 0;
  while (true) {
    const match = CODE_FENCE_RE.exec(text);
    if (!match) {
      break;
    }
    const language = (match[1] || '').toLowerCase();
    if (language !== 'json') {
      continue;
    }
    if (payloadLooksLikeJsonWidgetCandidate(parseLooseJson(match[2] || ''))) {
      return true;
    }
  }

  return DECLARATIVE_JSON_FENCE_HINT_RE.test(text);
}

export function parseAllShowWidgets(text: string): ShowWidgetPart[] {
  return parseWidgetParts(text).parts;
}

export function buildShowWidgetRenderPlan(
  text: string,
  options?: {
    liveStreaming?: boolean;
    telemetry?: {
      sessionId?: string;
      messageId?: string;
      runtime?: string;
      traceId?: string;
    };
  },
): ShowWidgetRenderPlan {
  if (!text) {
    return {
      parts: [],
      hasIncompleteWidget: false,
      hasMalformedWidget: false,
      widgetCount: 0,
    };
  }

  const liveStreaming = options?.liveStreaming === true;
  const trailingState = stripTrailingIncompleteWidgetFence(text);
  const source = liveStreaming
    ? trailingState
    : { text, hasIncompleteWidget: false };
  const parsed = parseWidgetParts(source.text);
  const hasDanglingIncompleteBlock = trailingState.hasIncompleteWidget;
  const hasMalformedWidget = parsed.recognizedFenceCount > parsed.widgetCount || (!liveStreaming && hasDanglingIncompleteBlock);
  const hasIncompleteWidget = source.hasIncompleteWidget;
  const traceId = options?.telemetry?.traceId || createWidgetTraceId('parse');
  const telemetryScope = options?.telemetry
    ? `${options.telemetry.sessionId || ''}:${options.telemetry.messageId || ''}:${liveStreaming ? 'live' : 'final'}`
    : '';
  const parseFingerprint = hashText([
    source.text.slice(0, 5000),
    String(source.text.length),
    String(parsed.widgetCount),
    String(parsed.recognizedFenceCount),
    String(parsed.recoveredFenceCount),
    String(parsed.recoveryFailureCount),
    hasMalformedWidget ? '1' : '0',
    hasIncompleteWidget ? '1' : '0',
  ].join('|'));
  const dedupeWindowMs = liveStreaming ? 2_500 : 8_000;

  if (parsed.recoveredFenceCount > 0) {
    publishWidgetTelemetry({
      event: 'widget_recover',
      ok: true,
      code: 'W_RECOVER_PAYLOAD_REPAIRED',
      traceId: `${traceId}:recover`,
      runtime: options?.telemetry?.runtime,
      sessionId: options?.telemetry?.sessionId,
      messageId: options?.telemetry?.messageId,
      meta: {
        recoveredFenceCount: parsed.recoveredFenceCount,
        recoveryFailureCount: parsed.recoveryFailureCount,
        recognizedFenceCount: parsed.recognizedFenceCount,
        liveStreaming,
      },
      dedupeKey: telemetryScope
        ? `widget_recover:ok:${telemetryScope}:${parseFingerprint}`
        : undefined,
      dedupeWindowMs,
    });
  }
  if (parsed.recoveryFailureCount > 0) {
    publishWidgetTelemetry({
      event: 'widget_recover',
      ok: false,
      code: 'W_RECOVER_TEXT_FALLBACK',
      traceId: `${traceId}:fallback`,
      runtime: options?.telemetry?.runtime,
      sessionId: options?.telemetry?.sessionId,
      messageId: options?.telemetry?.messageId,
      meta: {
        recoveryFailureCount: parsed.recoveryFailureCount,
        recognizedFenceCount: parsed.recognizedFenceCount,
        liveStreaming,
      },
      dedupeKey: telemetryScope
        ? `widget_recover:fallback:${telemetryScope}:${parseFingerprint}`
        : undefined,
      dedupeWindowMs,
    });
  }

  publishWidgetTelemetry({
    event: 'widget_parse',
    ok: !hasMalformedWidget,
    code: hasIncompleteWidget
      ? 'W_PARSE_INCOMPLETE_FENCE'
      : hasMalformedWidget
        ? 'W_PARSE_MALFORMED_PAYLOAD'
        : undefined,
    traceId,
    runtime: options?.telemetry?.runtime,
    sessionId: options?.telemetry?.sessionId,
    messageId: options?.telemetry?.messageId,
    meta: {
      liveStreaming,
      widgetCount: parsed.widgetCount,
      recognizedFenceCount: parsed.recognizedFenceCount,
      recoveredFenceCount: parsed.recoveredFenceCount,
      recoveryFailureCount: parsed.recoveryFailureCount,
      textLength: text.length,
    },
    dedupeKey: telemetryScope
      ? `widget_parse:${telemetryScope}:${parseFingerprint}`
      : undefined,
    dedupeWindowMs,
  });

  return {
    parts: parsed.parts,
    hasIncompleteWidget,
    hasMalformedWidget,
    widgetCount: parsed.widgetCount,
  };
}

export function stripTrailingIncompleteWidgetFence(text: string): { text: string; hasIncompleteWidget: boolean } {
  return stripTrailingIncompleteFenceWithMatcher(text, isPotentialIncompleteWidgetFence);
}

export function stripTrailingIncompleteShowWidget(text: string): { text: string; hasIncompleteWidget: boolean } {
  return stripTrailingIncompleteFenceWithMatcher(text, (language) => language === 'show-widget');
}

export function stripTrailingWidgetProtocolBlocks(text: string): string {
  if (!text) {
    return '';
  }

  const strippedIncomplete = stripTrailingIncompleteWidgetFence(text);
  if (strippedIncomplete.hasIncompleteWidget) {
    return strippedIncomplete.text;
  }

  return text;
}

export function stripCompletedShowWidgetBlocks(text: string): string {
  return text.replace(/```show-widget[\s\S]*?```/g, '');
}

export function stripCompletedWidgetProtocolBlocks(text: string): string {
  if (!text || text.length > MAX_REGEX_INPUT_LENGTH) {
    return text;
  }

  let cursor = 0;
  let output = '';
  CODE_FENCE_RE.lastIndex = 0;

  while (true) {
    const match = CODE_FENCE_RE.exec(text);
    if (!match) {
      break;
    }
    const start = match.index;
    const end = start + match[0].length;
    const language = (match[1] || '').toLowerCase();
    const rawPayload = match[2] || '';
    output += text.slice(cursor, start);

    const parsed = parseWidgetFencePayload(language, rawPayload);
    if (!parsed.recognized) {
      output += match[0];
    }

    cursor = end;
  }

  output += text.slice(cursor);
  return output;
}

export function sanitizeForStreaming(rawHtml: string): string {
  const sanitized = sanitizeWidgetHtml(rawHtml);
  if (rawHtml !== sanitized) {
    publishWidgetTelemetry({
      event: 'widget_sanitize',
      ok: true,
      code: 'W_SECURITY_PAYLOAD_REWRITTEN',
      traceId: createWidgetTraceId('sanitize_stream'),
      meta: {
        mode: 'streaming',
        rawLength: rawHtml.length,
        sanitizedLength: sanitized.length,
      },
    });
  }
  return sanitized;
}

export function sanitizeForIframe(rawHtml: string): string {
  const sanitized = sanitizeWidgetHtml(rawHtml);
  if (rawHtml !== sanitized) {
    publishWidgetTelemetry({
      event: 'widget_sanitize',
      ok: true,
      code: 'W_SECURITY_PAYLOAD_REWRITTEN',
      traceId: createWidgetTraceId('sanitize_iframe'),
      meta: {
        mode: 'iframe',
        rawLength: rawHtml.length,
        sanitizedLength: sanitized.length,
      },
    });
  }
  return sanitized;
}
