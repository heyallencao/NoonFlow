import crypto from 'crypto';

import { type PreparedConversationContext, buildContextBudgetLogFields } from './context-budget';
import { getDb } from './db-core';
import type { ContextBudgetRecoveryMetrics } from '@/types';
import type { WidgetTelemetryErrorCode, WidgetTelemetryEventName } from './widget-telemetry';
import { normalizeTelemetryCreatedAt } from './widget-telemetry-time';

export type { ContextBudgetRecoveryMetrics };

type ContextBudgetEventSource = 'ui' | 'bridge';

// Token Usage Statistics
// ==========================================
const HOUR_MS = 60 * 60 * 1000;

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function toUtcDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function buildLocalDateRange(length: number, endDate: Date): string[] {
  return Array.from({ length }, (_, index) => {
    const date = startOfLocalDay(endDate);
    date.setDate(date.getDate() - (length - index - 1));
    return toLocalDateKey(date);
  });
}

function toSqliteInt(value: boolean | number | string | undefined): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

function toStageValue(value: boolean | number | string | undefined): 'green' | 'warning' | 'soft' | 'hard' {
  return value === 'warning' || value === 'soft' || value === 'hard' ? value : 'green';
}

export interface WidgetTelemetryPersistEvent {
  event: WidgetTelemetryEventName;
  ok: boolean;
  code?: WidgetTelemetryErrorCode;
  runtime?: string;
  sessionId?: string;
  messageId?: string;
  traceId?: string;
  schemaVersion?: string;
  meta?: Record<string, unknown>;
  createdAt?: string;
}

function normalizeWidgetMetadata(meta: unknown): string {
  try {
    if (!meta || typeof meta !== 'object') {
      return '{}';
    }
    return JSON.stringify(meta);
  } catch {
    return '{}';
  }
}

export function recordWidgetTelemetryEvents(events: WidgetTelemetryPersistEvent[]): number {
  if (!Array.isArray(events) || events.length === 0) {
    return 0;
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO widget_telemetry_events (
      id,
      event_name,
      ok,
      error_code,
      assistant_runtime,
      session_id,
      message_id,
      trace_id,
      schema_version,
      metadata,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((batch: WidgetTelemetryPersistEvent[]) => {
    for (const event of batch) {
      const eventId = crypto.randomBytes(16).toString('hex');
      const createdAt = normalizeTelemetryCreatedAt(event.createdAt) || toUtcDateTime(new Date());
      insert.run(
        eventId,
        event.event,
        event.ok ? 1 : 0,
        event.code || '',
        event.runtime || '',
        event.sessionId?.trim() ? event.sessionId.trim() : null,
        event.messageId || '',
        event.traceId || '',
        event.schemaVersion || '1.0',
        normalizeWidgetMetadata(event.meta),
        createdAt,
      );
    }
  });

  tx(events.slice(0, 200));
  return Math.min(events.length, 200);
}

export function getWidgetTelemetryStats(days: number = 7): {
  summary: {
    totalEvents: number;
    errorEvents: number;
  };
  byEvent: Array<{
    event: WidgetTelemetryEventName;
    total: number;
    errors: number;
  }>;
  byCode: Array<{
    code: string;
    total: number;
  }>;
  recent: Array<{
    event: WidgetTelemetryEventName;
    ok: boolean;
    code: string;
    runtime: string;
    sessionId: string | null;
    messageId: string;
    traceId: string;
    schemaVersion: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
} {
  const db = getDb();
  const now = new Date();
  const rollingStart = new Date(now.getTime() - days * 24 * HOUR_MS);
  const rollingStartText = toUtcDateTime(rollingStart);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS totalEvents,
      COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errorEvents
    FROM widget_telemetry_events
    WHERE created_at >= ?
  `).get(rollingStartText) as { totalEvents: number; errorEvents: number };

  const byEvent = db.prepare(`
    SELECT
      event_name AS event,
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors
    FROM widget_telemetry_events
    WHERE created_at >= ?
    GROUP BY event_name
    ORDER BY total DESC
  `).all(rollingStartText) as Array<{ event: WidgetTelemetryEventName; total: number; errors: number }>;

  const byCode = db.prepare(`
    SELECT
      error_code AS code,
      COUNT(*) AS total
    FROM widget_telemetry_events
    WHERE created_at >= ?
      AND ok = 0
      AND error_code != ''
    GROUP BY error_code
    ORDER BY total DESC
    LIMIT 20
  `).all(rollingStartText) as Array<{ code: string; total: number }>;

  const recentRows = db.prepare(`
    SELECT
      event_name AS event,
      ok,
      error_code AS code,
      assistant_runtime AS runtime,
      session_id AS sessionId,
      message_id AS messageId,
      trace_id AS traceId,
      schema_version AS schemaVersion,
      metadata,
      created_at AS createdAt
    FROM widget_telemetry_events
    WHERE created_at >= ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(rollingStartText) as Array<{
    event: WidgetTelemetryEventName;
    ok: number;
    code: string;
    runtime: string;
    sessionId: string | null;
    messageId: string;
    traceId: string;
    schemaVersion: string;
    metadata: string;
    createdAt: string;
  }>;

  const recent = recentRows.map((row) => {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.metadata || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
    return {
      event: row.event,
      ok: row.ok === 1,
      code: row.code,
      runtime: row.runtime,
      sessionId: row.sessionId,
      messageId: row.messageId,
      traceId: row.traceId,
      schemaVersion: row.schemaVersion,
      metadata,
      createdAt: row.createdAt,
    };
  });

  return {
    summary: {
      totalEvents: Number(summary?.totalEvents || 0),
      errorEvents: Number(summary?.errorEvents || 0),
    },
    byEvent,
    byCode,
    recent,
  };
}

export function recordContextBudgetEvent(params: {
  sessionId: string;
  source: ContextBudgetEventSource;
  assistantRuntime: string;
  context: PreparedConversationContext;
  historyBeforeCount: number;
}): string {
  const db = getDb();
  const eventId = crypto.randomBytes(16).toString('hex');
  const fields = buildContextBudgetLogFields(params.context, params.historyBeforeCount);

  db.prepare(`
    INSERT INTO context_budget_events (
      id,
      session_id,
      source,
      assistant_runtime,
      compiled_input_chars,
      system_chars,
      history_chars,
      tool_output_chars,
      user_chars,
      metadata_chars,
      compiled_input_bytes,
      budget_utilization_pct,
      warning_limit,
      soft_limit,
      hard_limit,
      warning_limit_hit,
      soft_limit_hit,
      hard_limit_hit,
      native_resume_active,
      official_compact_attempted,
      local_compaction_attempted,
      local_compaction_applied,
      hard_trim_applied,
      history_messages_before,
      history_messages_after,
      budget_stage_before,
      budget_stage_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    params.sessionId,
    params.source,
    params.assistantRuntime || 'claude_code',
    toSqliteInt(fields.compiled_input_chars),
    toSqliteInt(fields.system_chars),
    toSqliteInt(fields.history_chars),
    toSqliteInt(fields.tool_output_chars),
    toSqliteInt(fields.user_chars),
    toSqliteInt(fields.metadata_chars),
    toSqliteInt(fields.compiled_input_bytes),
    toSqliteInt(fields.budget_utilization_pct),
    toSqliteInt(fields.warning_limit),
    toSqliteInt(fields.soft_limit),
    toSqliteInt(fields.hard_limit),
    toSqliteInt(fields.warning_limit_hit),
    toSqliteInt(fields.soft_limit_hit),
    toSqliteInt(fields.hard_limit_hit),
    toSqliteInt(fields.native_resume_active),
    toSqliteInt(fields.official_compact_attempted),
    toSqliteInt(fields.local_compaction_attempted),
    toSqliteInt(fields.local_compaction_applied),
    toSqliteInt(fields.hard_trim_applied),
    toSqliteInt(fields.history_messages_before),
    toSqliteInt(fields.history_messages_after),
    toStageValue(fields.budget_stage_before),
    toStageValue(fields.budget_stage_after),
  );

  return eventId;
}

export function updateContextBudgetRecoveryMetrics(
  eventId: string,
  metrics: ContextBudgetRecoveryMetrics,
): void {
  const db = getDb();
  db.prepare(`
    UPDATE context_budget_events
    SET
      official_compact_attempted = MAX(official_compact_attempted, ?),
      official_compact_success = MAX(COALESCE(official_compact_success, 0), ?),
      compact_retry_success = MAX(COALESCE(compact_retry_success, 0), ?),
      recovery_duration_ms = CASE
        WHEN ? IS NOT NULL THEN ?
        ELSE recovery_duration_ms
      END
    WHERE id = ?
  `).run(
    toSqliteInt(metrics.officialCompactAttempted),
    toSqliteInt(metrics.officialCompactSuccess),
    toSqliteInt(metrics.compactRetrySuccess),
    metrics.recoveryDurationMs ?? null,
    metrics.recoveryDurationMs ?? null,
    eventId,
  );
}

export function getContextBudgetStats(days: number = 30): {
  summary: {
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    hardTrimAppliedCount: number;
    nativeResumeActiveCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
    avgRecoveryDurationMs: number;
    maxRecoveryDurationMs: number;
    maxCompiledInputChars: number;
    avgCompiledInputChars: number;
  };
  daily: Array<{
    date: string;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;
  bySource: Array<{
    source: ContextBudgetEventSource;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;
  byRuntime: Array<{
    assistantRuntime: string;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;
  byStageAfter: Array<{
    stage: 'green' | 'warning' | 'soft' | 'hard';
    count: number;
  }>;
  recentHardLimitHits: Array<{
    sessionId: string;
    source: ContextBudgetEventSource;
    assistantRuntime: string;
    compiledInputChars: number;
    historyMessagesBefore: number;
    historyMessagesAfter: number;
    createdAt: string;
  }>;
  recentRecoveries: Array<{
    sessionId: string;
    source: ContextBudgetEventSource;
    assistantRuntime: string;
    officialCompactSuccess: boolean;
    compactRetrySuccess: boolean;
    recoveryDurationMs: number | null;
    createdAt: string;
  }>;
} {
  const db = getDb();
  const now = new Date();
  const rollingStart = new Date(now.getTime() - days * 24 * HOUR_MS);
  const rollingStartText = toUtcDateTime(rollingStart);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS totalEvents,
      COALESCE(SUM(warning_limit_hit), 0) AS warningLimitHitCount,
      COALESCE(SUM(soft_limit_hit), 0) AS softLimitHitCount,
      COALESCE(SUM(hard_limit_hit), 0) AS inputOverLimitCount,
      COALESCE(SUM(local_compaction_attempted), 0) AS softLimitCompactionCount,
      COALESCE(SUM(local_compaction_applied), 0) AS localCompactionAppliedCount,
      COALESCE(SUM(hard_trim_applied), 0) AS hardTrimAppliedCount,
      COALESCE(SUM(native_resume_active), 0) AS nativeResumeActiveCount,
      COALESCE(SUM(official_compact_attempted), 0) AS officialCompactAttemptCount,
      COALESCE(SUM(official_compact_success), 0) AS officialCompactSuccessCount,
      COALESCE(SUM(compact_retry_success), 0) AS compactRetrySuccessCount,
      COALESCE(AVG(recovery_duration_ms), 0) AS avgRecoveryDurationMs,
      COALESCE(MAX(recovery_duration_ms), 0) AS maxRecoveryDurationMs,
      COALESCE(MAX(compiled_input_chars), 0) AS maxCompiledInputChars,
      COALESCE(AVG(compiled_input_chars), 0) AS avgCompiledInputChars
    FROM context_budget_events
    WHERE created_at >= ?
  `).get(rollingStartText) as {
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    hardTrimAppliedCount: number;
    nativeResumeActiveCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
    avgRecoveryDurationMs: number;
    maxRecoveryDurationMs: number;
    maxCompiledInputChars: number;
    avgCompiledInputChars: number;
  };

  const dailyRows = db.prepare(`
    SELECT
      DATE(datetime(created_at, 'localtime')) AS date,
      COUNT(*) AS totalEvents,
      COALESCE(SUM(warning_limit_hit), 0) AS warningLimitHitCount,
      COALESCE(SUM(soft_limit_hit), 0) AS softLimitHitCount,
      COALESCE(SUM(hard_limit_hit), 0) AS inputOverLimitCount,
      COALESCE(SUM(local_compaction_attempted), 0) AS softLimitCompactionCount,
      COALESCE(SUM(official_compact_attempted), 0) AS officialCompactAttemptCount,
      COALESCE(SUM(official_compact_success), 0) AS officialCompactSuccessCount,
      COALESCE(SUM(compact_retry_success), 0) AS compactRetrySuccessCount
    FROM context_budget_events
    WHERE created_at >= ?
    GROUP BY DATE(datetime(created_at, 'localtime'))
    ORDER BY date ASC
  `).all(rollingStartText) as Array<{
    date: string;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;

  const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
  const daily = buildLocalDateRange(days, now).map((date) => {
    const row = dailyMap.get(date);
    return {
      date,
      totalEvents: row?.totalEvents ?? 0,
      warningLimitHitCount: row?.warningLimitHitCount ?? 0,
      softLimitHitCount: row?.softLimitHitCount ?? 0,
      inputOverLimitCount: row?.inputOverLimitCount ?? 0,
      softLimitCompactionCount: row?.softLimitCompactionCount ?? 0,
      officialCompactAttemptCount: row?.officialCompactAttemptCount ?? 0,
      officialCompactSuccessCount: row?.officialCompactSuccessCount ?? 0,
      compactRetrySuccessCount: row?.compactRetrySuccessCount ?? 0,
    };
  });

  const bySource = db.prepare(`
    SELECT
      source,
      COUNT(*) AS totalEvents,
      COALESCE(SUM(warning_limit_hit), 0) AS warningLimitHitCount,
      COALESCE(SUM(soft_limit_hit), 0) AS softLimitHitCount,
      COALESCE(SUM(hard_limit_hit), 0) AS inputOverLimitCount,
      COALESCE(SUM(local_compaction_attempted), 0) AS softLimitCompactionCount,
      COALESCE(SUM(local_compaction_applied), 0) AS localCompactionAppliedCount,
      COALESCE(SUM(official_compact_attempted), 0) AS officialCompactAttemptCount,
      COALESCE(SUM(official_compact_success), 0) AS officialCompactSuccessCount,
      COALESCE(SUM(compact_retry_success), 0) AS compactRetrySuccessCount
    FROM context_budget_events
    WHERE created_at >= ?
    GROUP BY source
    ORDER BY totalEvents DESC, source ASC
  `).all(rollingStartText) as Array<{
    source: ContextBudgetEventSource;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;

  const byRuntime = db.prepare(`
    SELECT
      assistant_runtime AS assistantRuntime,
      COUNT(*) AS totalEvents,
      COALESCE(SUM(warning_limit_hit), 0) AS warningLimitHitCount,
      COALESCE(SUM(soft_limit_hit), 0) AS softLimitHitCount,
      COALESCE(SUM(hard_limit_hit), 0) AS inputOverLimitCount,
      COALESCE(SUM(local_compaction_attempted), 0) AS softLimitCompactionCount,
      COALESCE(SUM(local_compaction_applied), 0) AS localCompactionAppliedCount,
      COALESCE(SUM(official_compact_attempted), 0) AS officialCompactAttemptCount,
      COALESCE(SUM(official_compact_success), 0) AS officialCompactSuccessCount,
      COALESCE(SUM(compact_retry_success), 0) AS compactRetrySuccessCount
    FROM context_budget_events
    WHERE created_at >= ?
    GROUP BY assistant_runtime
    ORDER BY totalEvents DESC, assistant_runtime ASC
  `).all(rollingStartText) as Array<{
    assistantRuntime: string;
    totalEvents: number;
    warningLimitHitCount: number;
    softLimitHitCount: number;
    inputOverLimitCount: number;
    softLimitCompactionCount: number;
    localCompactionAppliedCount: number;
    officialCompactAttemptCount: number;
    officialCompactSuccessCount: number;
    compactRetrySuccessCount: number;
  }>;

  const byStageAfter = db.prepare(`
    SELECT
      budget_stage_after AS stage,
      COUNT(*) AS count
    FROM context_budget_events
    WHERE created_at >= ?
    GROUP BY budget_stage_after
    ORDER BY count DESC, stage ASC
  `).all(rollingStartText) as Array<{
    stage: 'green' | 'warning' | 'soft' | 'hard';
    count: number;
  }>;

  const recentHardLimitHits = db.prepare(`
    SELECT
      session_id AS sessionId,
      source,
      assistant_runtime AS assistantRuntime,
      compiled_input_chars AS compiledInputChars,
      history_messages_before AS historyMessagesBefore,
      history_messages_after AS historyMessagesAfter,
      datetime(created_at, 'localtime') AS createdAt
    FROM context_budget_events
    WHERE created_at >= ?
      AND hard_limit_hit = 1
    ORDER BY created_at DESC
    LIMIT 10
  `).all(rollingStartText) as Array<{
    sessionId: string;
    source: ContextBudgetEventSource;
    assistantRuntime: string;
    compiledInputChars: number;
    historyMessagesBefore: number;
    historyMessagesAfter: number;
    createdAt: string;
  }>;

  const recentRecoveries = db.prepare(`
    SELECT
      session_id AS sessionId,
      source,
      assistant_runtime AS assistantRuntime,
      official_compact_success AS officialCompactSuccess,
      compact_retry_success AS compactRetrySuccess,
      recovery_duration_ms AS recoveryDurationMs,
      datetime(created_at, 'localtime') AS createdAt
    FROM context_budget_events
    WHERE created_at >= ?
      AND official_compact_attempted = 1
    ORDER BY created_at DESC
    LIMIT 10
  `).all(rollingStartText) as Array<{
    sessionId: string;
    source: ContextBudgetEventSource;
    assistantRuntime: string;
    officialCompactSuccess: number;
    compactRetrySuccess: number;
    recoveryDurationMs: number | null;
    createdAt: string;
  }>;

  // SQLite stores booleans as integers (0/1); cast to JS boolean before returning.
  const recentRecoveriesMapped = recentRecoveries.map((row) => ({
    ...row,
    officialCompactSuccess: Boolean(row.officialCompactSuccess),
    compactRetrySuccess: Boolean(row.compactRetrySuccess),
  }));

  return {
    summary,
    daily,
    bySource,
    byRuntime,
    byStageAfter,
    recentHardLimitHits,
    recentRecoveries: recentRecoveriesMapped,
  };
}

export function getTokenUsageStats(days: number = 30): {
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };
  daily: Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;
  periods: {
    todayCost: number;
    weekCost: number;
    monthCost: number;
    totalCost: number;
  };
  byModel: Array<{
    model: string;
    cost: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    cost: number;
    sessions: number;
  }>;
  dailyCosts: Array<{
    date: string;
    cost: number;
  }>;
  weeklyTrend: Array<{
    date: string;
    cost: number;
  }>;
} {
  const db = getDb();
  const now = new Date();
  const todayStart = toUtcDateTime(startOfLocalDay(now));
  const weekStart = toUtcDateTime(startOfLocalWeek(now));
  const monthStart = toUtcDateTime(startOfLocalMonth(now));
  const rollingStart = new Date(now.getTime() - days * 24 * HOUR_MS);
  const rollingStartText = toUtcDateTime(rollingStart);

  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS total_input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS total_output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS total_cost,
      COUNT(DISTINCT m.session_id) AS total_sessions,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_read_input_tokens')), 0) AS cache_read_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cache_creation_input_tokens')), 0) AS cache_creation_tokens
    FROM messages m
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= ?
  `).get(rollingStartText) as {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
    total_sessions: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  };

  const daily = db.prepare(`
    SELECT
      DATE(datetime(m.created_at, 'localtime')) AS date,
      CASE
        WHEN COALESCE(NULLIF(s.provider_name, ''), '') != ''
        THEN s.provider_name
        ELSE COALESCE(NULLIF(s.model, ''), 'unknown')
      END AS model,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) AS input_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS output_tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS cost
    FROM messages m
    LEFT JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= ?
    GROUP BY DATE(datetime(m.created_at, 'localtime')),
      CASE
        WHEN COALESCE(NULLIF(s.provider_name, ''), '') != ''
        THEN s.provider_name
        ELSE COALESCE(NULLIF(s.model, ''), 'unknown')
      END
    ORDER BY date ASC
  `).all(rollingStartText) as Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;

  const periods = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN m.created_at >= ? THEN json_extract(m.token_usage, '$.cost_usd') END), 0) AS todayCost,
      COALESCE(SUM(CASE WHEN m.created_at >= ? THEN json_extract(m.token_usage, '$.cost_usd') END), 0) AS weekCost,
      COALESCE(SUM(CASE WHEN m.created_at >= ? THEN json_extract(m.token_usage, '$.cost_usd') END), 0) AS monthCost,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS totalCost
    FROM messages m
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
  `).get(todayStart, weekStart, monthStart) as {
    todayCost: number;
    weekCost: number;
    monthCost: number;
    totalCost: number;
  };

  const dailyCostMap = new Map<string, number>();
  const modelCostMap = new Map<string, number>();

  const byRuntime = db.prepare(`
    SELECT
      CASE
        WHEN COALESCE(NULLIF(s.assistant_runtime, ''), '') != ''
        THEN s.assistant_runtime
        ELSE 'claude_code'
      END AS runtime,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS cost,
      COUNT(DISTINCT m.session_id) AS sessions
    FROM messages m
    LEFT JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.token_usage IS NOT NULL
      AND json_valid(m.token_usage) = 1
      AND m.created_at >= ?
    GROUP BY runtime
    ORDER BY cost DESC
  `).all(rollingStartText) as Array<{
    runtime: string;
    cost: number;
    sessions: number;
  }>;

  for (const row of daily) {
    dailyCostMap.set(row.date, (dailyCostMap.get(row.date) ?? 0) + row.cost);
    modelCostMap.set(row.model, (modelCostMap.get(row.model) ?? 0) + row.cost);
  }

  const dailyCosts = buildLocalDateRange(days, now).map((date) => ({
    date,
    cost: dailyCostMap.get(date) ?? 0,
  }));

  const weeklyTrend = buildLocalDateRange(7, now).map((date) => ({
    date,
    cost: dailyCostMap.get(date) ?? 0,
  }));

  const byModel = Array.from(modelCostMap.entries())
    .map(([model, cost]) => ({ model, cost }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

  return { summary, daily, periods, byModel, byRuntime, dailyCosts, weeklyTrend };
}

// ==========================================
// Sessions Statistics
// ==========================================

export function getSessionsStats(days: number = 30): {
  summary: {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
  };
  byWorkspace: Array<{
    workspacePath: string;
    count: number;
    messageCount: number;
    lastUpdated: string;
  }>;
  byModel: Array<{
    model: string;
    tokens: number;
    count: number;
  }>;
  byRuntime: Array<{
    runtime: string;
    count: number;
    messageCount: number;
    tokens: number;
    totalCost: number;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    sessionType: string;
    workingDirectory: string;
    updatedAt: string;
    messageCount: number;
    assistantRuntime: string;
  }>;
  activityHeatmap: Array<{
    date: string;
    count: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
} {
  const db = getDb();
  const now = new Date();
  const rollingStart = new Date(now.getTime() - days * 24 * HOUR_MS);
  const rollingStartText = toUtcDateTime(rollingStart);

  // Summary statistics
  const summary = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) AS totalSessions,
      COUNT(m.id) AS totalMessages,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) +
        COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS totalTokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS totalCost
    FROM chat_sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.updated_at >= ?
  `).get(rollingStartText) as {
    totalSessions: number;
    totalMessages: number;
    totalTokens: number;
    totalCost: number;
  };

  // By workspace distribution
  const byWorkspace = db.prepare(`
    SELECT
      s.working_directory AS workspacePath,
      COUNT(DISTINCT s.id) AS count,
      COUNT(m.id) AS messageCount,
      MAX(datetime(s.updated_at, 'localtime')) AS lastUpdated
    FROM chat_sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.updated_at >= ?
      AND s.working_directory != ''
    GROUP BY s.working_directory
    ORDER BY count DESC, lastUpdated DESC
    LIMIT 20
  `).all(rollingStartText) as Array<{
    workspacePath: string;
    count: number;
    messageCount: number;
    lastUpdated: string;
  }>;

  // By model distribution - with tokens and count
  const byModel = db.prepare(`
    SELECT
      CASE
        WHEN COALESCE(NULLIF(s.provider_name, ''), '') != ''
        THEN s.provider_name
        WHEN COALESCE(NULLIF(s.model, ''), '') != ''
        THEN s.model
        ELSE 'Legacy Sessions'
      END AS model,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) +
        COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS tokens,
      COUNT(DISTINCT s.id) AS count
    FROM chat_sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.updated_at >= ?
    GROUP BY model
    ORDER BY count DESC
  `).all(rollingStartText) as Array<{
    model: string;
    tokens: number;
    count: number;
  }>;

  const byRuntime = db.prepare(`
    SELECT
      CASE
        WHEN COALESCE(NULLIF(s.assistant_runtime, ''), '') != ''
        THEN s.assistant_runtime
        ELSE 'claude_code'
      END AS runtime,
      COUNT(DISTINCT s.id) AS count,
      COUNT(m.id) AS messageCount,
      COALESCE(SUM(json_extract(m.token_usage, '$.input_tokens')), 0) +
        COALESCE(SUM(json_extract(m.token_usage, '$.output_tokens')), 0) AS tokens,
      COALESCE(SUM(json_extract(m.token_usage, '$.cost_usd')), 0) AS totalCost
    FROM chat_sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.updated_at >= ?
    GROUP BY runtime
    ORDER BY count DESC
  `).all(rollingStartText) as Array<{
    runtime: string;
    count: number;
    messageCount: number;
    tokens: number;
    totalCost: number;
  }>;

  // Recent sessions
  const recentSessions = db.prepare(`
    SELECT
      s.id,
      s.title,
      s.session_type AS sessionType,
      s.working_directory AS workingDirectory,
      datetime(s.updated_at, 'localtime') AS updatedAt,
      COUNT(m.id) AS messageCount,
      CASE
        WHEN COALESCE(NULLIF(s.assistant_runtime, ''), '') != ''
        THEN s.assistant_runtime
        ELSE 'claude_code'
      END AS assistantRuntime
    FROM chat_sessions s
    LEFT JOIN messages m ON s.id = m.session_id
    WHERE s.updated_at >= ?
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT 10
  `).all(rollingStartText) as Array<{
    id: string;
    title: string;
    sessionType: string;
    workingDirectory: string;
    updatedAt: string;
    messageCount: number;
    assistantRuntime: string;
  }>;

  // Activity heatmap
  const activityHeatmap = db.prepare(`
    SELECT
      DATE(datetime(s.updated_at, 'localtime')) AS date,
      COUNT(DISTINCT s.id) AS count
    FROM chat_sessions s
    WHERE s.updated_at >= ?
    GROUP BY DATE(datetime(s.updated_at, 'localtime'))
    ORDER BY date ASC
  `).all(rollingStartText) as Array<{
    date: string;
    count: number;
  }>;

  // Hourly distribution (0-23)
  const hourlyRaw = db.prepare(`
    SELECT CAST(strftime('%H', datetime(s.updated_at, 'localtime')) AS INTEGER) AS hour,
           COUNT(DISTINCT s.id) AS count
    FROM chat_sessions s
    WHERE s.updated_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(rollingStartText) as Array<{ hour: number; count: number }>;

  const hourlyMap = new Map(hourlyRaw.map((r) => [r.hour, r.count]));
  const hourlyDistribution = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourlyMap.get(i) ?? 0,
  }));

  return {
    summary,
    byWorkspace,
    byModel,
    byRuntime,
    recentSessions,
    activityHeatmap,
    hourlyDistribution,
  };
}

// ==========================================
// Tools Statistics
// ==========================================

type ParsedToolCall = {
  toolName: string;
  sessionId: string;
  isError: boolean;
  error?: string;
  updatedAt: string;
  input?: unknown;
};

function normalizeToolName(toolName: string): string {
  const aliases: Record<string, string> = {
    bash_20241022: 'Bash',
    Bash: 'Bash',
    bash: 'Bash',
    Read: 'Read',
    read: 'Read',
    Edit: 'Edit',
    edit: 'Edit',
    Write: 'Write',
    write: 'Write',
    Grep: 'Grep',
    grep: 'Grep',
    Glob: 'Glob',
    glob: 'Glob',
    WebFetch: 'WebFetch',
    web_fetch: 'WebFetch',
    WebSearch: 'WebSearch',
    web_search: 'WebSearch',
  };

  return aliases[toolName] ?? (toolName || 'unknown');
}

function getUtcDateString(daysAgo: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function extractCommandName(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const toolInput = input as { command?: string; cmd?: string };
  const rawCommand = toolInput.command || toolInput.cmd;
  if (!rawCommand || typeof rawCommand !== 'string') {
    return null;
  }

  const command = rawCommand.trim().split(/\s+/)[0];
  return command || null;
}

function extractFilePath(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const toolInput = input as { file_path?: string; path?: string };

  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    if (typeof toolInput.file_path === 'string') {
      return toolInput.file_path;
    }
    if (typeof toolInput.path === 'string') {
      return toolInput.path;
    }
  }

  return null;
}

export function getToolsStats(days: number = 30): {
  summary: {
    totalToolCalls: number;
    errorRate: number;
    distinctTools: number;
    errorCount: number;
    totalFilesTouched: number;
    totalSessions: number;
    avgCallsPerSession: number;
    previousPeriodToolCalls: number;
    busiestDay: {
      date: string;
      count: number;
    } | null;
  };
  byTool: Array<{
    toolName: string;
    count: number;
    errorRate: number;
    errorCount: number;
  }>;
  dailyUsage: Array<{
    date: string;
    count: number;
  }>;
  commonSequences: Array<{
    sequence: string;
    count: number;
  }>;
  errorProneTools: Array<{
    toolName: string;
    errorCount: number;
    errorRate: number;
  }>;
  recentFailures: Array<{
    sessionId: string;
    toolName: string;
    updatedAt: string;
    error: string;
  }>;
  topCommands: Array<{
    command: string;
    count: number;
  }>;
  topFiles: Array<{
    path: string;
    count: number;
  }>;
} {
  const db = getDb();
  const now = new Date();
  const currentPeriodStart = toUtcDateTime(new Date(now.getTime() - days * 24 * HOUR_MS));
  const previousPeriodStart = toUtcDateTime(new Date(now.getTime() - days * 2 * 24 * HOUR_MS));

  const messages = db.prepare(`
    SELECT
      m.id,
      m.session_id,
      m.content,
      m.created_at
    FROM messages m
    WHERE m.role = 'assistant'
      AND m.created_at >= ?
    ORDER BY m.created_at ASC
  `).all(previousPeriodStart) as Array<{
    id: string;
    session_id: string;
    content: string;
    created_at: string;
  }>;

  const toolCallsMap = new Map<string, ParsedToolCall>();

  for (const message of messages) {
    try {
      const contentBlocks = JSON.parse(message.content);
      if (!Array.isArray(contentBlocks)) continue;

      // First pass: collect all tool_use blocks
      for (const block of contentBlocks) {
        if (block.type === 'tool_use') {
          toolCallsMap.set(block.id, {
            toolName: normalizeToolName(block.name || 'unknown'),
            sessionId: message.session_id,
            isError: false,
            updatedAt: message.created_at,
            input: block.input,
          });
        }
      }

      // Second pass: match tool_result blocks to tool_use
      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const toolUseId = block.tool_use_id;
          if (toolUseId && toolCallsMap.has(toolUseId)) {
            const call = toolCallsMap.get(toolUseId)!;
            call.isError = block.is_error === true;
            if (call.isError && block.content) {
              call.error = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
            }
          }
        }
      }
    } catch {
      // Skip invalid JSON
      continue;
    }
  }

  const toolCalls = Array.from(toolCallsMap.values());
  const currentToolCalls = toolCalls.filter((call) => call.updatedAt >= currentPeriodStart);
  const previousToolCalls = toolCalls.filter(
    (call) => call.updatedAt >= previousPeriodStart && call.updatedAt < currentPeriodStart
  );

  const totalToolCalls = currentToolCalls.length;
  const errorCount = currentToolCalls.filter(c => c.isError).length;
  const errorRate = totalToolCalls > 0 ? errorCount / totalToolCalls : 0;
  const distinctTools = new Set(currentToolCalls.map(c => c.toolName)).size;
  const totalSessions = new Set(currentToolCalls.map(c => c.sessionId)).size;
  const avgCallsPerSession = totalSessions > 0 ? totalToolCalls / totalSessions : 0;

  const toolCountMap = new Map<string, { count: number; errors: number }>();
  for (const call of currentToolCalls) {
    const existing = toolCountMap.get(call.toolName) || { count: 0, errors: 0 };
    existing.count++;
    if (call.isError) existing.errors++;
    toolCountMap.set(call.toolName, existing);
  }

  const allToolStats = Array.from(toolCountMap.entries())
    .map(([toolName, stats]) => ({
      toolName,
      count: stats.count,
      errorRate: stats.count > 0 ? stats.errors / stats.count : 0,
      errorCount: stats.errors,
    }));

  const byTool = allToolStats
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const errorProneTools = allToolStats
    .filter((tool) => tool.errorCount > 0)
    .sort((a, b) => {
      if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
      return b.errorRate - a.errorRate;
    })
    .slice(0, 8)
    .map((tool) => ({
      toolName: tool.toolName,
      errorCount: tool.errorCount,
      errorRate: tool.errorRate,
    }));

  const dailyUsageMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    const date = call.updatedAt.slice(0, 10);
    dailyUsageMap.set(date, (dailyUsageMap.get(date) || 0) + 1);
  }

  const dailyUsage = Array.from({ length: days }, (_, index) => {
    const date = getUtcDateString(days - index - 1);
    return {
      date,
      count: dailyUsageMap.get(date) ?? 0,
    };
  });

  const busiestDay = totalToolCalls === 0
    ? null
    : dailyUsage.reduce<{ date: string; count: number } | null>((current, day) => {
        if (!current || day.count > current.count) {
          return day;
        }
        return current;
      }, null);

  const recentFailures = currentToolCalls
    .filter(c => c.isError)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10)
    .map(c => ({
      sessionId: c.sessionId,
      toolName: c.toolName,
      updatedAt: c.updatedAt,
      error: c.error || 'Unknown error',
    }));

  const commandCountMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    const command = extractCommandName(call.input);
    if (command) {
      commandCountMap.set(command, (commandCountMap.get(command) || 0) + 1);
    }
  }

  const topCommands = Array.from(commandCountMap.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const fileCountMap = new Map<string, number>();
  for (const call of currentToolCalls) {
    const filePath = extractFilePath(call.toolName, call.input);
    if (filePath) {
      fileCountMap.set(filePath, (fileCountMap.get(filePath) || 0) + 1);
    }
  }

  const topFiles = Array.from(fileCountMap.entries())
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const sequenceCountMap = new Map<string, number>();
  for (let index = 1; index < currentToolCalls.length; index += 1) {
    const previousCall = currentToolCalls[index - 1];
    const currentCall = currentToolCalls[index];

    if (previousCall.sessionId !== currentCall.sessionId) {
      continue;
    }

    const sequence = `${previousCall.toolName} -> ${currentCall.toolName}`;
    sequenceCountMap.set(sequence, (sequenceCountMap.get(sequence) || 0) + 1);
  }

  const commonSequences = Array.from(sequenceCountMap.entries())
    .map(([sequence, count]) => ({ sequence, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const summary = {
    totalToolCalls,
    errorRate,
    distinctTools,
    errorCount,
    totalFilesTouched: fileCountMap.size,
    totalSessions,
    avgCallsPerSession,
    previousPeriodToolCalls: previousToolCalls.length,
    busiestDay,
  };

  return {
    summary,
    byTool,
    dailyUsage,
    commonSequences,
    errorProneTools,
    recentFailures,
    topCommands,
    topFiles,
  };
}
