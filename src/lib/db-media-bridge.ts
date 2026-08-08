import crypto from 'crypto';
import type {
  BatchConfig,
  MediaContextEvent,
  MediaJob,
  MediaJobItem,
  MediaJobItemStatus,
  MediaJobStatus,
} from '@/types';
import type { SessionRuntimeLockRecord } from './db-core/types';
import type { ChannelType, ChannelBinding } from './bridge/types';
import { updateSessionStateRecord } from './db-session';
import { getDb } from './db-core';
import { expirePermissionRequestsInDatabase } from './db-permission-requests';

// Media Job Operations
// ==========================================

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 2,
  maxRetries: 2,
  retryDelayMs: 2000,
};

export function createMediaJob(params: {
  sessionId?: string;
  docPaths?: string[];
  stylePrompt?: string;
  batchConfig?: Partial<BatchConfig>;
  totalItems: number;
}): MediaJob {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const config = { ...DEFAULT_BATCH_CONFIG, ...params.batchConfig };

  db.prepare(
    `INSERT INTO media_jobs (id, session_id, status, doc_paths, style_prompt, batch_config, total_items, completed_items, failed_items, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    id,
    params.sessionId || null,
    'planned',
    JSON.stringify(params.docPaths || []),
    params.stylePrompt || '',
    JSON.stringify(config),
    params.totalItems,
    now,
    now,
  );

  return getMediaJob(id)!;
}

export function getMediaJob(id: string): MediaJob | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(id) as MediaJob | undefined;
}

export function getMediaJobsBySession(sessionId: string): MediaJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as MediaJob[];
}

export function getAllMediaJobs(limit = 50, offset = 0): MediaJob[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as MediaJob[];
}

export function updateMediaJobStatus(id: string, status: MediaJobStatus): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const completedAt = (status === 'completed' || status === 'cancelled' || status === 'failed') ? now : null;

  db.prepare(
    'UPDATE media_jobs SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
  ).run(status, now, completedAt, id);
}

export function updateMediaJobCounters(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    UPDATE media_jobs SET
      completed_items = (SELECT COUNT(*) FROM media_job_items WHERE job_id = ? AND status = 'completed'),
      failed_items = (SELECT COUNT(*) FROM media_job_items WHERE job_id = ? AND status = 'failed'),
      updated_at = ?
    WHERE id = ?
  `).run(id, id, now, id);
}

export function deleteMediaJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM media_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ==========================================
// Media Job Item Operations
// ==========================================

export function createMediaJobItems(jobId: string, items: Array<{
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
  tags?: string[];
  sourceRefs?: string[];
}>): MediaJobItem[] {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const insertStmt = db.prepare(
    `INSERT INTO media_job_items (id, job_id, idx, prompt, aspect_ratio, image_size, model, tags, source_refs, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  );

  const ids: string[] = [];
  const transaction = db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = crypto.randomBytes(16).toString('hex');
      ids.push(id);
      insertStmt.run(
        id, jobId, i,
        item.prompt,
        item.aspectRatio || '1:1',
        item.imageSize || '1K',
        item.model || '',
        JSON.stringify(item.tags || []),
        JSON.stringify(item.sourceRefs || []),
        now, now,
      );
    }
  });
  transaction();

  return ids.map(id => db.prepare('SELECT * FROM media_job_items WHERE id = ?').get(id) as MediaJobItem);
}

export function getMediaJobItems(jobId: string): MediaJobItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM media_job_items WHERE job_id = ? ORDER BY idx ASC').all(jobId) as MediaJobItem[];
}

export function getMediaJobItem(id: string): MediaJobItem | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM media_job_items WHERE id = ?').get(id) as MediaJobItem | undefined;
}

export function getPendingJobItems(jobId: string, maxRetries: number): MediaJobItem[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM media_job_items
     WHERE job_id = ? AND (status = 'pending' OR (status = 'failed' AND retry_count < ?))
     ORDER BY idx ASC`
  ).all(jobId, maxRetries) as MediaJobItem[];
}

export function updateMediaJobItem(id: string, updates: {
  status?: MediaJobItemStatus;
  retryCount?: number;
  resultMediaGenerationId?: string | null;
  error?: string | null;
  prompt?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags?: string[];
}): MediaJobItem | undefined {
  const db = getDb();
  const existing = getMediaJobItem(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(`
    UPDATE media_job_items SET
      status = ?,
      retry_count = ?,
      result_media_generation_id = ?,
      error = ?,
      prompt = ?,
      aspect_ratio = ?,
      image_size = ?,
      tags = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.status ?? existing.status,
    updates.retryCount ?? existing.retry_count,
    updates.resultMediaGenerationId !== undefined ? updates.resultMediaGenerationId : existing.result_media_generation_id,
    updates.error !== undefined ? updates.error : existing.error,
    updates.prompt ?? existing.prompt,
    updates.aspectRatio ?? existing.aspect_ratio,
    updates.imageSize ?? existing.image_size,
    updates.tags ? JSON.stringify(updates.tags) : existing.tags,
    now,
    id,
  );

  return getMediaJobItem(id);
}

export function cancelPendingJobItems(jobId: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    "UPDATE media_job_items SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status IN ('pending', 'failed')"
  ).run(now, jobId);
}

// ==========================================
// Media Context Event Operations
// ==========================================

export function createContextEvent(params: {
  sessionId: string;
  jobId: string;
  payload: Record<string, unknown>;
  syncMode?: 'manual' | 'auto_batch';
}): MediaContextEvent {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    `INSERT INTO media_context_events (id, session_id, job_id, payload, sync_mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, params.sessionId, params.jobId, JSON.stringify(params.payload), params.syncMode || 'manual', now);

  return db.prepare('SELECT * FROM media_context_events WHERE id = ?').get(id) as MediaContextEvent;
}

export function markContextEventSynced(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare('UPDATE media_context_events SET synced_at = ? WHERE id = ?').run(now, id);
}

// ==========================================
// Session Runtime Lock Operations
// ==========================================

/**
 * Acquire an exclusive lock for a session.
 * Uses SQLite's single-writer guarantee: within a transaction, delete expired
 * locks then INSERT. PK conflict = already locked → return false.
 */
export function acquireSessionLock(
  sessionId: string,
  lockId: string,
  owner: string,
  ttlSec: number = 300,
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').split('.')[0];

  const txn = db.transaction(() => {
    // Delete expired locks first
    db.prepare("DELETE FROM session_runtime_locks WHERE expires_at < ?").run(now);
    // Try to insert — PK conflict means session is already locked
    try {
      db.prepare(
        'INSERT INTO session_runtime_locks (session_id, lock_id, owner, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(sessionId, lockId, owner, expiresAt, now, now);
      return true;
    } catch {
      return false;
    }
  });

  return txn();
}

/**
 * Renew an existing session lock by extending its expiry.
 */
export function renewSessionLock(
  sessionId: string,
  lockId: string,
  ttlSec: number = 300,
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').split('.')[0];

  const result = db.prepare(
    'UPDATE session_runtime_locks SET expires_at = ?, updated_at = ? WHERE session_id = ? AND lock_id = ?'
  ).run(expiresAt, now, sessionId, lockId);

  return result.changes > 0;
}

export function getSessionLock(sessionId: string): SessionRuntimeLockRecord | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT session_id, lock_id, owner, expires_at, created_at, updated_at FROM session_runtime_locks WHERE session_id = ?'
  ).get(sessionId) as SessionRuntimeLockRecord | undefined;
}

/**
 * Release a session lock.
 */
export function releaseSessionLock(sessionId: string, lockId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM session_runtime_locks WHERE session_id = ? AND lock_id = ?'
  ).run(sessionId, lockId);
  return result.changes > 0;
}

/**
 * Force-release all locks for a session.
 * Used by explicit stop paths to recover from stale lock states.
 */
export function forceReleaseSessionLocks(sessionId: string): number {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM session_runtime_locks WHERE session_id = ?'
  ).run(sessionId);
  return result.changes;
}

/**
 * Update the runtime status of a session.
 */
export function setSessionRuntimeStatus(
  sessionId: string,
  status: string,
  error?: string,
): void {
  updateSessionStateRecord(sessionId, {
    runtimeStatus: status,
    runtimeError: error || '',
  });
}

// ==========================================
// Permission Request Operations
// ==========================================

/**
 * Create a pending permission request record in DB.
 */
export function createPermissionRequest(params: {
  id: string;
  sessionId: string;
  sdkSessionId?: string;
  toolName: string;
  toolInput: string;
  decisionReason?: string;
  expiresAt: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO permission_requests (id, session_id, sdk_session_id, tool_name, tool_input, decision_reason, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    params.id,
    params.sessionId,
    params.sdkSessionId || '',
    params.toolName,
    params.toolInput,
    params.decisionReason || '',
    params.expiresAt,
  );
}

/**
 * Resolve a pending permission request. Only updates if status is still 'pending'.
 * Returns true if the request was found and resolved, false otherwise.
 */
export function resolvePermissionRequest(
  id: string,
  status: 'allow' | 'deny' | 'timeout' | 'aborted',
  opts?: {
    updatedPermissions?: unknown[];
    updatedInput?: Record<string, unknown>;
    message?: string;
  },
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare(
    `UPDATE permission_requests
     SET status = ?, resolved_at = ?, updated_permissions = ?, updated_input = ?, message = ?
     WHERE id = ? AND status = 'pending'`
  ).run(
    status,
    now,
    JSON.stringify(opts?.updatedPermissions || []),
    opts?.updatedInput ? JSON.stringify(opts.updatedInput) : null,
    opts?.message || '',
    id,
  );
  return result.changes > 0;
}

/**
 * Expire all pending permission requests that have passed their expiry time.
 */
export function expirePermissionRequests(now?: string): number {
  const db = getDb();
  return expirePermissionRequestsInDatabase(db, now);
}

/**
 * Get a permission request by ID.
 */
export interface PermissionRequestRecord {
  id: string;
  session_id: string;
  sdk_session_id: string;
  tool_name: string;
  tool_input: string;
  decision_reason: string;
  status: string;
  updated_permissions: string;
  updated_input: string | null;
  message: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

export function getPermissionRequest(id: string): PermissionRequestRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id) as PermissionRequestRecord | undefined;
}

export function getLatestPendingPermissionRequestForSession(sessionId: string): PermissionRequestRecord | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT *
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(sessionId) as PermissionRequestRecord | undefined;
}

// ==========================================
// Bridge: Channel Binding Operations
// ==========================================

export function getChannelBinding(channelType: ChannelType, chatId: string): ChannelBinding | undefined {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM channel_bindings WHERE channel_type = ? AND chat_id = ?'
  ).get(channelType, chatId) as {
    id: string; channel_type: string; chat_id: string; monolith_session_id: string;
    sdk_session_id: string; working_directory: string; model: string; mode: string;
    active: number; created_at: string; updated_at: string;
  } | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    channelType: row.channel_type as ChannelType,
    chatId: row.chat_id,
    sessionId: row.monolith_session_id,
    sdkSessionId: row.sdk_session_id,
    workingDirectory: row.working_directory,
    model: row.model,
    mode: row.mode as 'code' | 'plan' | 'ask',
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertChannelBinding(params: {
  channelType: ChannelType;
  chatId: string;
  sessionId: string;
  sdkSessionId?: string;
  workingDirectory?: string;
  model?: string;
  mode?: 'code' | 'plan' | 'ask';
}): ChannelBinding {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const existing = getChannelBinding(params.channelType, params.chatId);

  if (existing) {
    db.prepare(
      `UPDATE channel_bindings SET monolith_session_id = ?, sdk_session_id = ?, working_directory = ?, model = ?, mode = ?, updated_at = ?
       WHERE channel_type = ? AND chat_id = ?`
    ).run(
      params.sessionId,
      params.sdkSessionId ?? existing.sdkSessionId,
      params.workingDirectory ?? existing.workingDirectory,
      params.model ?? existing.model,
      params.mode ?? existing.mode,
      now,
      params.channelType,
      params.chatId,
    );
  } else {
    const id = crypto.randomBytes(16).toString('hex');
    db.prepare(
      `INSERT INTO channel_bindings (id, channel_type, chat_id, monolith_session_id, sdk_session_id, working_directory, model, mode, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      params.channelType,
      params.chatId,
      params.sessionId,
      params.sdkSessionId || '',
      params.workingDirectory || '',
      params.model || '',
      params.mode || 'code',
      now,
      now,
    );
  }

  return getChannelBinding(params.channelType, params.chatId)!;
}

export function listChannelBindings(channelType?: ChannelType): ChannelBinding[] {
  const db = getDb();
  let rows: Array<{
    id: string; channel_type: string; chat_id: string; monolith_session_id: string;
    sdk_session_id: string; working_directory: string; model: string; mode: string;
    active: number; created_at: string; updated_at: string;
  }>;

  if (channelType) {
    rows = db.prepare('SELECT * FROM channel_bindings WHERE channel_type = ? ORDER BY updated_at DESC').all(channelType) as typeof rows;
  } else {
    rows = db.prepare('SELECT * FROM channel_bindings ORDER BY updated_at DESC').all() as typeof rows;
  }

  return rows.map(row => ({
    id: row.id,
    channelType: row.channel_type as ChannelType,
    chatId: row.chat_id,
    sessionId: row.monolith_session_id,
    sdkSessionId: row.sdk_session_id,
    workingDirectory: row.working_directory,
    model: row.model,
    mode: row.mode as 'code' | 'plan' | 'ask',
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateChannelBinding(
  id: string,
  updates: Partial<Pick<ChannelBinding, 'sdkSessionId' | 'workingDirectory' | 'model' | 'mode' | 'active'>>,
): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const sets: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (updates.sdkSessionId !== undefined) { sets.push('sdk_session_id = ?'); values.push(updates.sdkSessionId); }
  if (updates.workingDirectory !== undefined) { sets.push('working_directory = ?'); values.push(updates.workingDirectory); }
  if (updates.model !== undefined) { sets.push('model = ?'); values.push(updates.model); }
  if (updates.mode !== undefined) { sets.push('mode = ?'); values.push(updates.mode); }
  if (updates.active !== undefined) { sets.push('active = ?'); values.push(updates.active ? 1 : 0); }

  values.push(id);
  db.prepare(`UPDATE channel_bindings SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ==========================================
// Bridge: Channel Offset Operations
// ==========================================

export function getChannelOffset(channelType: ChannelType | string): string {
  const db = getDb();
  const row = db.prepare('SELECT offset_value FROM channel_offsets WHERE channel_type = ?').get(channelType) as { offset_value: string } | undefined;
  return row?.offset_value || '0';
}

export function setChannelOffset(channelType: ChannelType | string, offsetValue: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT INTO channel_offsets (channel_type, offset_value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(channel_type) DO UPDATE SET offset_value = excluded.offset_value, updated_at = excluded.updated_at`
  ).run(channelType, offsetValue, now);
}

// ==========================================
// Bridge: Dedup Operations
// ==========================================

export function checkDedup(dedupKey: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM channel_dedupe WHERE dedup_key = ?').get(dedupKey);
  return !!row;
}

export function insertDedup(dedupKey: string, ttlMs: number = 24 * 60 * 60 * 1000): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT OR IGNORE INTO channel_dedupe (dedup_key, created_at, expires_at) VALUES (?, ?, ?)`
  ).run(dedupKey, now, expiresAt);
}

export function cleanupExpiredDedup(): number {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare('DELETE FROM channel_dedupe WHERE expires_at < ?').run(now);
  return result.changes;
}

// ==========================================
// Bridge: Outbound Ref Operations
// ==========================================

export function insertOutboundRef(params: {
  channelType: ChannelType;
  chatId: string;
  sessionId: string;
  platformMessageId: string;
  purpose?: string;
}): void {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT INTO channel_outbound_refs (id, channel_type, chat_id, monolith_session_id, platform_message_id, purpose, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.channelType, params.chatId, params.sessionId, params.platformMessageId, params.purpose || 'response', now);
}

export function getOutboundRefs(sessionId: string): Array<{
  id: string;
  channelType: ChannelType;
  chatId: string;
  platformMessageId: string;
  purpose: string;
  createdAt: string;
}> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM channel_outbound_refs WHERE monolith_session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Array<{
    id: string; channel_type: string; chat_id: string; monolith_session_id: string;
    platform_message_id: string; purpose: string; created_at: string;
  }>;
  return rows.map(r => ({
    id: r.id,
    channelType: r.channel_type as ChannelType,
    chatId: r.chat_id,
    platformMessageId: r.platform_message_id,
    purpose: r.purpose,
    createdAt: r.created_at,
  }));
}

// ==========================================
// Bridge: Audit Log Operations
// ==========================================

export function insertAuditLog(params: {
  channelType: ChannelType;
  chatId: string;
  direction: 'inbound' | 'outbound';
  messageId?: string;
  summary?: string;
}): void {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT INTO channel_audit_logs (id, channel_type, chat_id, direction, message_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.channelType, params.chatId, params.direction, params.messageId || '', params.summary || '', now);
}

export function getAuditLogs(channelType: ChannelType, chatId: string, limit: number = 50): Array<{
  id: string;
  channelType: ChannelType;
  chatId: string;
  direction: 'inbound' | 'outbound';
  messageId: string;
  summary: string;
  createdAt: string;
}> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM channel_audit_logs WHERE channel_type = ? AND chat_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(channelType, chatId, limit) as Array<{
    id: string; channel_type: string; chat_id: string; direction: string;
    message_id: string; summary: string; created_at: string;
  }>;
  return rows.map(r => ({
    id: r.id,
    channelType: r.channel_type as ChannelType,
    chatId: r.chat_id,
    direction: r.direction as 'inbound' | 'outbound',
    messageId: r.message_id,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

// ==========================================
// Bridge: Permission Link Operations
// ==========================================

export function insertPermissionLink(params: {
  permissionRequestId: string;
  channelType: ChannelType;
  chatId: string;
  messageId: string;
  toolName?: string;
  suggestions?: string;
}): void {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    `INSERT INTO channel_permission_links (id, permission_request_id, channel_type, chat_id, message_id, tool_name, suggestions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.permissionRequestId, params.channelType, params.chatId, params.messageId, params.toolName || '', params.suggestions || '', now);
}

export function getPermissionLink(permissionRequestId: string): {
  id: string;
  permissionRequestId: string;
  channelType: ChannelType;
  chatId: string;
  messageId: string;
  toolName: string;
  suggestions: string;
  resolved: boolean;
  createdAt: string;
} | undefined {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM channel_permission_links WHERE permission_request_id = ?'
  ).get(permissionRequestId) as {
    id: string; permission_request_id: string; channel_type: string;
    chat_id: string; message_id: string; tool_name: string;
    suggestions: string; resolved: number; created_at: string;
  } | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    permissionRequestId: row.permission_request_id,
    channelType: row.channel_type as ChannelType,
    chatId: row.chat_id,
    messageId: row.message_id,
    toolName: row.tool_name,
    suggestions: row.suggestions,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
  };
}

/**
 * Atomically mark a permission link as resolved.
 * Uses `resolved = 0` in the WHERE clause to prevent double-resolution races.
 * Returns true if the row was actually updated (i.e., it was not already resolved).
 */
export function markPermissionLinkResolved(permissionRequestId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE channel_permission_links SET resolved = 1 WHERE permission_request_id = ? AND resolved = 0'
  ).run(permissionRequestId);
  return result.changes > 0;
}
