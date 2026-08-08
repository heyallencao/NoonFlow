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
