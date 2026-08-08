import { parseMessageContent } from '@/types';
import { getDb } from '../db';
import type { MessagePartRecord } from '../db-core/types';
import { replayMessageContentFromParts, resolveMessageContentFromParts } from '../message-content';

type ReplaySourceKind = 'content' | 'legacy_parts' | 'v2_parts' | 'resolved';
type ReplaySessionType = 'chat' | 'terminal';
type ReplaySessionTypeFilter = ReplaySessionType | 'all';

interface RawMessageRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  token_usage: string | null;
  client_message_id: string | null;
  status: string | null;
  content_format_version: number | null;
  completed_at: string | null;
  persisted_revision: number | null;
}

export interface ReplaySourceSnapshot {
  kind: ReplaySourceKind;
  raw: string | null;
  normalized: string | null;
}

export interface ReplayComparisonResult {
  left: ReplaySourceKind;
  right: ReplaySourceKind;
  matches: boolean;
}

export interface ReplayValidationMessageReport {
  messageId: string;
  role: RawMessageRecord['role'];
  status: string | null;
  persistedRevision: number | null;
  comparable: boolean;
  skippedStrictMismatchCheck: boolean;
  sources: ReplaySourceSnapshot[];
  comparisons: ReplayComparisonResult[];
  hasMismatch: boolean;
}

export interface ReplayValidationReport {
  sessionId: string;
  messageCount: number;
  comparableMessageCount: number;
  skippedStreamingMessageCount: number;
  mismatchCount: number;
  messages: ReplayValidationMessageReport[];
}

export interface ReplaySampleValidationOptions {
  sampleSize?: number;
  sinceUpdatedAt?: string;
  sessionType?: ReplaySessionTypeFilter;
}

export interface ReplaySampleSessionReport {
  sessionId: string;
  updatedAt: string;
  sessionType: ReplaySessionType;
  messageCount: number;
  comparableMessageCount: number;
  skippedStreamingMessageCount: number;
  mismatchCount: number;
}

export interface ReplaySampleValidationReport {
  sampleSize: number;
  sinceUpdatedAt: string | null;
  sessionType: ReplaySessionTypeFilter;
  selectedSessionCount: number;
  totalMessageCount: number;
  totalComparableMessageCount: number;
  totalSkippedStreamingMessageCount: number;
  totalMismatchCount: number;
  sessions: ReplaySampleSessionReport[];
}

interface ReplaySampleCandidate {
  id: string;
  updated_at: string;
  session_type: ReplaySessionType;
}

function normalizeContent(content: string | null): string | null {
  if (content === null) {
    return null;
  }
  return JSON.stringify(parseMessageContent(content));
}

function buildSourceSnapshot(kind: ReplaySourceKind, raw: string | null): ReplaySourceSnapshot {
  return {
    kind,
    raw,
    normalized: normalizeContent(raw),
  };
}

function buildComparisons(sources: ReplaySourceSnapshot[]): ReplayComparisonResult[] {
  const available = sources.filter((source) => source.normalized !== null);
  const comparisons: ReplayComparisonResult[] = [];

  for (let i = 0; i < available.length; i += 1) {
    for (let j = i + 1; j < available.length; j += 1) {
      comparisons.push({
        left: available[i]!.kind,
        right: available[j]!.kind,
        matches: available[i]!.normalized === available[j]!.normalized,
      });
    }
  }

  return comparisons;
}

function normalizeSampleSize(value?: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return 20;
  }
  return Math.min(200, Math.floor(value));
}

function listReplaySampleCandidates(options: ReplaySampleValidationOptions): ReplaySampleCandidate[] {
  const db = getDb();
  const sampleSize = normalizeSampleSize(options.sampleSize);
  const sessionType = options.sessionType ?? 'all';
  const sinceUpdatedAt = options.sinceUpdatedAt?.trim();
  const whereClauses = ['EXISTS (SELECT 1 FROM messages m WHERE m.session_id = chat_sessions.id)'];
  const params: unknown[] = [];

  if (sessionType === 'chat' || sessionType === 'terminal') {
    whereClauses.push('session_type = ?');
    params.push(sessionType);
  }

  if (sinceUpdatedAt) {
    whereClauses.push('updated_at >= ?');
    params.push(sinceUpdatedAt);
  }

  params.push(sampleSize);
  const sql = `
    SELECT id, updated_at, session_type
    FROM chat_sessions
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `;

  return db.prepare(sql).all(...params) as ReplaySampleCandidate[];
}

export function validateSessionReplay(sessionId: string): ReplayValidationReport {
  const db = getDb();
  const messages = db.prepare(`
    SELECT
      id,
      session_id,
      role,
      content,
      created_at,
      token_usage,
      client_message_id,
      status,
      content_format_version,
      completed_at,
      persisted_revision
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(sessionId) as RawMessageRecord[];

  const parts = db.prepare(`
    SELECT
      id,
      session_id,
      message_id,
      part_type,
      content,
      metadata,
      created_at,
      part_key,
      part_index,
      revision,
      is_final,
      updated_at
    FROM message_parts
    WHERE session_id = ?
    ORDER BY message_id ASC, COALESCE(part_index, id) ASC, id ASC
  `).all(sessionId) as MessagePartRecord[];

  const partsByMessageId = new Map<string, MessagePartRecord[]>();
  for (const part of parts) {
    const current = partsByMessageId.get(part.message_id) ?? [];
    current.push(part);
    partsByMessageId.set(part.message_id, current);
  }

  const reports = messages.map((message) => {
    const messageParts = partsByMessageId.get(message.id) ?? [];
    const v2Parts = messageParts.filter((part) => typeof part.part_key === 'string' && part.part_key.trim().length > 0);
    const legacyParts = v2Parts.length > 0
      ? messageParts.filter((part) => !(typeof part.part_key === 'string' && part.part_key.trim().length > 0))
      : messageParts;

    const sources: ReplaySourceSnapshot[] = [
      buildSourceSnapshot('content', message.content.trim().length > 0 ? message.content : null),
      buildSourceSnapshot('legacy_parts', legacyParts.length > 0 ? replayMessageContentFromParts(legacyParts) : null),
      buildSourceSnapshot('v2_parts', v2Parts.length > 0 ? replayMessageContentFromParts(v2Parts) : null),
      buildSourceSnapshot('resolved', resolveMessageContentFromParts({
        content: message.content,
        status: message.status,
        parts: messageParts,
      })),
    ];

    const comparisons = buildComparisons(sources);
    const comparable = sources.filter((source) => source.normalized !== null).length > 1;
    const skippedStrictMismatchCheck = message.status === 'streaming';
    const hasMismatch = comparable
      && !skippedStrictMismatchCheck
      && comparisons.some((comparison) => !comparison.matches);

    return {
      messageId: message.id,
      role: message.role,
      status: message.status,
      persistedRevision: message.persisted_revision,
      comparable,
      skippedStrictMismatchCheck,
      sources,
      comparisons,
      hasMismatch,
    } satisfies ReplayValidationMessageReport;
  });

  return {
    sessionId,
    messageCount: reports.length,
    comparableMessageCount: reports.filter((report) => report.comparable).length,
    skippedStreamingMessageCount: reports.filter((report) => report.skippedStrictMismatchCheck).length,
    mismatchCount: reports.filter((report) => report.hasMismatch).length,
    messages: reports,
  };
}

export function validateSampledSessionReplays(
  options: ReplaySampleValidationOptions = {},
): ReplaySampleValidationReport {
  const sampleSize = normalizeSampleSize(options.sampleSize);
  const sessionType = options.sessionType ?? 'all';
  const sinceUpdatedAt = options.sinceUpdatedAt?.trim() || null;
  const candidates = listReplaySampleCandidates({
    sampleSize,
    sessionType,
    sinceUpdatedAt: sinceUpdatedAt ?? undefined,
  });

  const sessions = candidates.map((candidate) => {
    const report = validateSessionReplay(candidate.id);
    return {
      sessionId: candidate.id,
      updatedAt: candidate.updated_at,
      sessionType: candidate.session_type,
      messageCount: report.messageCount,
      comparableMessageCount: report.comparableMessageCount,
      skippedStreamingMessageCount: report.skippedStreamingMessageCount,
      mismatchCount: report.mismatchCount,
    } satisfies ReplaySampleSessionReport;
  });

  return {
    sampleSize,
    sinceUpdatedAt,
    sessionType,
    selectedSessionCount: sessions.length,
    totalMessageCount: sessions.reduce((sum, session) => sum + session.messageCount, 0),
    totalComparableMessageCount: sessions.reduce((sum, session) => (
      sum + session.comparableMessageCount
    ), 0),
    totalSkippedStreamingMessageCount: sessions.reduce((sum, session) => (
      sum + session.skippedStreamingMessageCount
    ), 0),
    totalMismatchCount: sessions.reduce((sum, session) => sum + session.mismatchCount, 0),
    sessions,
  };
}

export function formatReplayValidationReport(report: ReplayValidationReport): string {
  const lines = [
    `session=${report.sessionId}`,
    `messages=${report.messageCount}`,
    `comparable=${report.comparableMessageCount}`,
    `skipped_streaming=${report.skippedStreamingMessageCount}`,
    `mismatches=${report.mismatchCount}`,
  ];

  for (const message of report.messages.filter((entry) => entry.hasMismatch)) {
    lines.push(
      `mismatch message=${message.messageId} role=${message.role} status=${message.status ?? 'null'} revision=${message.persistedRevision ?? 'null'}`,
    );
    for (const comparison of message.comparisons.filter((entry) => !entry.matches)) {
      lines.push(`  ${comparison.left} != ${comparison.right}`);
    }
  }

  return lines.join('\n');
}

export function formatReplaySampleValidationReport(report: ReplaySampleValidationReport): string {
  const lines = [
    `sample_size=${report.sampleSize}`,
    `session_type=${report.sessionType}`,
    `since=${report.sinceUpdatedAt ?? ''}`,
    `selected_sessions=${report.selectedSessionCount}`,
    `messages=${report.totalMessageCount}`,
    `comparable=${report.totalComparableMessageCount}`,
    `skipped_streaming=${report.totalSkippedStreamingMessageCount}`,
    `mismatches=${report.totalMismatchCount}`,
  ];

  for (const session of report.sessions.filter((entry) => entry.mismatchCount > 0)) {
    lines.push(
      `mismatch session=${session.sessionId} type=${session.sessionType} updated_at=${session.updatedAt} messages=${session.messageCount} mismatches=${session.mismatchCount}`,
    );
  }

  return lines.join('\n');
}
