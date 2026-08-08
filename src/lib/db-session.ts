import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import type {
  AssistantRuntime,
  ChatSession,
  Message,
  SettingsMap,
  TaskItem,
  TaskStatus,
  ApiProvider,
  CreateProviderRequest,
  UpdateProviderRequest,
  SessionListType,
  SessionType,
} from '@/types';
import type {
  MessagePartInput,
  MessagePartRecord,
  SessionRuntimeStateRecord,
  SessionRuntimeStatePatch,
} from './db-core';
import { ensureDefaultWorktree, ensureWorktreeSchema, getWorktreeByPath } from './db-workspace';
import { getDb } from './db-core';
import { resolveMessageContentFromParts } from './message-content';
import { isManagedWorktreeSubPath } from './workspace-utils';

// Session Operations
// ==========================================

type SessionChangeType = 'upsert' | 'delete';

interface SessionChangeRow {
  id: number;
  session_id: string;
  session_type: SessionType;
  change_type: SessionChangeType;
}

interface SessionCursorResult {
  sessions: ChatSession[];
  deletedSessionIds: string[];
  nextCursor: number;
}

interface AddMessageOptions {
  status?: string | null;
  contentFormatVersion?: number | null;
  completedAt?: string | null;
  persistedRevision?: number | null;
}

interface UpdateMessageOptions extends AddMessageOptions {
  tokenUsage?: string | null;
}

type PersistedMessageRow = Message & { _rowid?: number };

export class MessageIdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageIdempotencyConflictError';
  }
}

function getMessageById(messageId: string): Message {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Message;
}

function findMessageByClientMessageId(
  sessionId: string,
  role: 'user' | 'assistant',
  clientMessageId: string,
): Message | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM messages WHERE session_id = ? AND client_message_id = ? AND role = ? ORDER BY rowid DESC LIMIT 1'
  ).get(sessionId, clientMessageId, role) as Message | undefined;
}

function findAssistantMessageByClientMessageId(sessionId: string, clientMessageId: string): Message | undefined {
  return findMessageByClientMessageId(sessionId, 'assistant', clientMessageId);
}

function findUserMessageByClientMessageId(sessionId: string, clientMessageId: string): Message | undefined {
  return findMessageByClientMessageId(sessionId, 'user', clientMessageId);
}

export function getAssistantMessageByClientMessageId(sessionId: string, clientMessageId: string): Message | undefined {
  return findAssistantMessageByClientMessageId(sessionId, clientMessageId);
}

export function getUserMessageByClientMessageId(sessionId: string, clientMessageId: string): Message | undefined {
  return findUserMessageByClientMessageId(sessionId, clientMessageId);
}

function normalizeUserMessageContentForIdempotency(content: string): string {
  const match = content.match(/^<!--files:(.*?)-->/);
  if (!match) {
    return content;
  }

  try {
    const files = JSON.parse(match[1]) as Array<Record<string, unknown>>;
    const normalizedFiles = files.map((file) => {
      const normalized = { ...file };
      delete normalized.filePath;
      delete normalized.data;
      return normalized;
    });
    return `<!--files:${JSON.stringify(normalizedFiles)}-->${content.slice(match[0].length)}`;
  } catch {
    return content;
  }
}

function assertUserMessageIdempotency(existing: Message, incomingContent: string): void {
  if (
    normalizeUserMessageContentForIdempotency(existing.content)
    === normalizeUserMessageContentForIdempotency(incomingContent)
  ) {
    return;
  }

  throw new MessageIdempotencyConflictError(
    `client_message_id ${existing.client_message_id} is already bound to different user content`,
  );
}

function getSessionChangeCursor(database: Database.Database): number {
  const row = database.prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM session_change_log').get() as { cursor: number };
  return row?.cursor ?? 0;
}

function getChangedSessionsByCursor(
  database: Database.Database,
  sessionType: SessionListType,
  cursor: number,
  nextCursor: number,
): Omit<SessionCursorResult, 'nextCursor'> {
  const changes = sessionType === 'all'
    ? database.prepare(
      `SELECT id, session_id, session_type, change_type
       FROM session_change_log
       WHERE id > ? AND id <= ?
       ORDER BY id ASC`
    ).all(cursor, nextCursor) as SessionChangeRow[]
    : database.prepare(
      `SELECT id, session_id, session_type, change_type
       FROM session_change_log
       WHERE session_type = ? AND id > ? AND id <= ?
       ORDER BY id ASC`
    ).all(sessionType, cursor, nextCursor) as SessionChangeRow[];

  const latestChanges = new Map<string, SessionChangeRow>();
  for (const change of changes) {
    latestChanges.set(change.session_id, change);
  }

  const orderedChanges = Array.from(latestChanges.values()).sort((left, right) => right.id - left.id);
  const deletedSessionIds = orderedChanges
    .filter(change => change.change_type === 'delete')
    .map(change => change.session_id);
  const upsertSessionIds = orderedChanges
    .filter(change => change.change_type === 'upsert')
    .map(change => change.session_id);

  if (upsertSessionIds.length === 0) {
    return { sessions: [], deletedSessionIds };
  }

  const placeholders = upsertSessionIds.map(() => '?').join(', ');
  const sessions = sessionType === 'all'
    ? database.prepare(`SELECT * FROM chat_sessions WHERE id IN (${placeholders})`).all(...upsertSessionIds) as ChatSession[]
    : database.prepare(`SELECT * FROM chat_sessions WHERE session_type = ? AND id IN (${placeholders})`).all(sessionType, ...upsertSessionIds) as ChatSession[];

  const changeOrder = new Map(orderedChanges.map(change => [change.session_id, change.id]));
  sessions.sort((left, right) => {
    const leftOrder = changeOrder.get(left.id) ?? 0;
    const rightOrder = changeOrder.get(right.id) ?? 0;
    return rightOrder - leftOrder;
  });

  return { sessions, deletedSessionIds };
}

export function getAllSessions(
  sessionType: SessionListType = 'chat',
  workspace?: string,
): ChatSession[] {
  const db = getDb();
  if (workspace) {
    if (sessionType === 'all') {
      return db.prepare('SELECT * FROM chat_sessions WHERE working_directory = ? ORDER BY updated_at DESC').all(workspace) as ChatSession[];
    }
    return db
      .prepare('SELECT * FROM chat_sessions WHERE session_type = ? AND working_directory = ? ORDER BY updated_at DESC')
      .all(sessionType, workspace) as ChatSession[];
  }
  if (sessionType === 'all') {
    return db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as ChatSession[];
  }
  return db
    .prepare('SELECT * FROM chat_sessions WHERE session_type = ? ORDER BY updated_at DESC')
    .all(sessionType) as ChatSession[];
}

export function getSessionsByCursor(
  sessionType: SessionListType = 'chat',
  cursor?: number,
  workspace?: string,
): SessionCursorResult {
  const database = getDb();
  const nextCursor = getSessionChangeCursor(database);

  if (cursor === undefined) {
    return {
      sessions: getAllSessions(sessionType, workspace),
      deletedSessionIds: [],
      nextCursor,
    };
  }

  const { sessions, deletedSessionIds } = getChangedSessionsByCursor(database, sessionType, cursor, nextCursor);
  // Apply workspace filter to changed sessions if provided
  const filteredSessions = workspace
    ? sessions.filter((s) => s.working_directory === workspace)
    : sessions;
  return {
    sessions: filteredSessions,
    deletedSessionIds,
    nextCursor,
  };
}

/**
 * Get sessions that are currently running or waiting for permission.
 */
export function getActiveSessions(): ChatSession[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM chat_sessions WHERE runtime_status IN ('running', 'waiting_permission', 'stopping') ORDER BY runtime_updated_at DESC"
  ).all() as ChatSession[];
}

export function getSession(id: string): ChatSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession | undefined;
}

export function createSession(
  title?: string,
  model?: string,
  systemPrompt?: string,
  workingDirectory?: string,
  mode?: string,
  providerId?: string,
  sessionType: 'chat' | 'terminal' = 'chat',
  worktreeId?: string,
  assistantRuntime: AssistantRuntime = 'claude_code',
): ChatSession {
  const db = getDb();
  ensureWorktreeSchema(db);
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const wd = workingDirectory || '';
  let resolvedWorktreeId = (worktreeId || '').trim();
  if (!resolvedWorktreeId && wd) {
    try {
      const existingWorktree = getWorktreeByPath(wd);
      if (existingWorktree?.id) {
        resolvedWorktreeId = existingWorktree.id;
      } else if (!isManagedWorktreeSubPath(wd)) {
        // When creating from a workspace root, bind to its default worktree.
        resolvedWorktreeId = ensureDefaultWorktree(wd, '').id;
      }
    } catch {
      // Keep backward-compatible behavior if worktree inference fails.
      resolvedWorktreeId = '';
    }
  }
  const projectName = path.basename(wd);

  db.prepare(
    'INSERT INTO chat_sessions (id, title, session_type, created_at, updated_at, model, system_prompt, working_directory, sdk_session_id, project_name, status, mode, sdk_cwd, provider_id, worktree_id, assistant_runtime, assistant_runtime_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    title || (sessionType === 'terminal' ? 'New Terminal' : 'New Chat'),
    sessionType,
    now,
    now,
    model || '',
    systemPrompt || '',
    wd,
    '',
    projectName,
    'active',
    mode || 'code',
    wd,
    providerId || '',
    resolvedWorktreeId,
    assistantRuntime,
    '',
  );

  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateSessionTimestamp(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, id);
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
}

export function updateSessionSystemPrompt(id: string, systemPrompt: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET system_prompt = ? WHERE id = ?').run(systemPrompt, id);
}

export interface SessionStatePatch {
  sdkSessionId?: string;
  sdkCwd?: string;
  runtimeStatus?: string;
  runtimeError?: string;
  workingDirectory?: string;
  projectName?: string;
}

export function updateSessionStateRecord(id: string, patch: SessionStatePatch): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Array<string> = [];
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  let touchedRuntimeTimestamp = false;

  if (patch.sdkSessionId !== undefined) {
    sets.push('sdk_session_id = ?');
    values.push(patch.sdkSessionId);
  }
  if (patch.sdkCwd !== undefined) {
    sets.push('sdk_cwd = ?');
    values.push(patch.sdkCwd);
  }
  if (patch.workingDirectory !== undefined) {
    sets.push('working_directory = ?');
    values.push(patch.workingDirectory);
    sets.push('project_name = ?');
    values.push(patch.projectName ?? path.basename(patch.workingDirectory));
    if (patch.sdkCwd === undefined) {
      sets.push('sdk_cwd = ?');
      values.push(patch.workingDirectory);
    }
  }
  if (patch.runtimeStatus !== undefined) {
    sets.push('runtime_status = ?');
    values.push(patch.runtimeStatus);
    sets.push('runtime_updated_at = ?');
    values.push(now);
    touchedRuntimeTimestamp = true;
  }
  if (patch.runtimeError !== undefined) {
    sets.push('runtime_error = ?');
    values.push(patch.runtimeError);
    if (!touchedRuntimeTimestamp) {
      sets.push('runtime_updated_at = ?');
      values.push(now);
    }
  }

  if (sets.length === 0) {
    return;
  }

  values.push(id);
  db.prepare(`UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function updateSdkSessionId(id: string, sdkSessionId: string): void {
  updateSessionStateRecord(id, { sdkSessionId });
}

export function updateSessionModel(id: string, model: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET model = ? WHERE id = ?').run(model, id);
}

export function updateSessionProvider(id: string, providerName: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_name = ? WHERE id = ?').run(providerName, id);
}

export function updateSessionProviderId(id: string, providerId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_id = ? WHERE id = ?').run(providerId, id);
}

export function updateSessionAssistantRuntime(id: string, assistantRuntime: AssistantRuntime): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET assistant_runtime = ? WHERE id = ?').run(assistantRuntime, id);
}

export function updateSessionAssistantRuntimeVersion(id: string, version: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET assistant_runtime_version = ? WHERE id = ?').run(version, id);
}

export function getDefaultProviderId(): string | undefined {
  return getSetting('default_provider_id') || undefined;
}

export function setDefaultProviderId(id: string): void {
  setSetting('default_provider_id', id);
}

export function updateSessionWorkingDirectory(id: string, workingDirectory: string): void {
  updateSessionStateRecord(id, { workingDirectory });
}

export function updateSessionMode(id: string, mode: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET mode = ? WHERE id = ?').run(mode, id);
}

// ==========================================
// Message Operations
// ==========================================

export function getMessages(
  sessionId: string,
  options?: { limit?: number; beforeRowId?: number },
): { messages: Message[]; hasMore: boolean } {
  const db = getDb();
  const limit = options?.limit ?? 100;
  const beforeRowId = options?.beforeRowId;

  let rows: PersistedMessageRow[];
  if (beforeRowId) {
    // Fetch `limit + 1` rows before the cursor to detect if there are more
    rows = db.prepare(
      'SELECT *, rowid as _rowid FROM messages WHERE session_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?'
    ).all(sessionId, beforeRowId, limit + 1) as PersistedMessageRow[];
  } else {
    // Fetch the most recent `limit + 1` messages
    rows = db.prepare(
      'SELECT *, rowid as _rowid FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?'
    ).all(sessionId, limit + 1) as PersistedMessageRow[];
  }

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows = rows.slice(0, limit);
  }

  // Reverse to chronological order (ASC)
  rows.reverse();
  return { messages: hydrateMessageRows(rows), hasMore };
}

/**
 * Recover assistant rows that were left in `streaming` status after an interrupted
 * stream (for example when the request channel disconnects mid-turn).
 *
 * This preserves any content that has already been checkpointed in `message_parts`
 * and marks the row as terminal so it is no longer treated as an in-flight turn.
 */
export function recoverDanglingStreamingAssistantMessages(sessionId: string): number {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, content, status, persisted_revision
     FROM messages
     WHERE session_id = ?
       AND role = 'assistant'
       AND status = 'streaming'
     ORDER BY created_at DESC`
  ).all(sessionId) as Array<{
    id: string;
    content: string;
    status: string | null;
    persisted_revision: number | null;
  }>;

  if (rows.length === 0) {
    return 0;
  }

  const selectParts = db.prepare(
    `SELECT
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
    WHERE message_id = ?
    ORDER BY COALESCE(part_index, id) ASC, id ASC`
  );
  const markPartsFinal = db.prepare(
    `UPDATE message_parts
     SET is_final = 1,
         updated_at = COALESCE(updated_at, ?)
     WHERE message_id = ?`
  );

  let recovered = 0;
  const nowIso = new Date().toISOString().replace('T', ' ').split('.')[0];
  const nowMs = Date.now();

  for (const row of rows) {
    const parts = selectParts.all(row.id) as MessagePartRecord[];
    const resolvedContent = resolveMessageContentFromParts({
      content: row.content || '',
      status: row.status,
      parts,
    });

    // Keep truly empty placeholders untouched; they can be safely replaced by retries.
    if (!resolvedContent.trim() && parts.length === 0) {
      continue;
    }

    const maxRevisionFromParts = parts.reduce((acc, part) => {
      if (!Number.isInteger(part.revision)) {
        return acc;
      }
      return Math.max(acc, part.revision as number);
    }, 0);
    const nextRevision = Math.max(row.persisted_revision ?? 0, maxRevisionFromParts);

    const updateOptions: UpdateMessageOptions = {
      status: 'error',
      contentFormatVersion: 2,
      completedAt: nowIso,
    };
    if (nextRevision > 0) {
      updateOptions.persistedRevision = nextRevision;
    }
    updateMessageRecord(row.id, resolvedContent, updateOptions);

    if (parts.length > 0) {
      markPartsFinal.run(nowMs, row.id);
    }

    recovered += 1;
  }

  return recovered;
}

export function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  tokenUsage?: string | null,
  clientMessageId?: string | null,
  options?: AddMessageOptions,
): Message {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    `INSERT INTO messages (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sessionId,
    role,
    content,
    now,
    tokenUsage || null,
    clientMessageId || null,
    options?.status ?? null,
    options?.contentFormatVersion ?? null,
    options?.completedAt ?? null,
    options?.persistedRevision ?? null,
  );

  updateSessionTimestamp(sessionId);

  return getMessageById(id);
}

export function updateMessageRecord(messageId: string, content: string, options?: UpdateMessageOptions): Message {
  const db = getDb();
  const existing = db.prepare('SELECT session_id FROM messages WHERE id = ?').get(messageId) as { session_id: string } | undefined;
  db.prepare(`
    UPDATE messages
    SET content = ?,
        token_usage = COALESCE(?, token_usage),
        status = ?,
        content_format_version = ?,
        completed_at = ?,
        persisted_revision = ?
    WHERE id = ?
  `).run(
    content,
    options?.tokenUsage ?? null,
    options?.status ?? null,
    options?.contentFormatVersion ?? null,
    options?.completedAt ?? null,
    options?.persistedRevision ?? null,
    messageId,
  );
  if (existing?.session_id) {
    updateSessionTimestamp(existing.session_id);
  }

  return getMessageById(messageId);
}

export function createAssistantPlaceholderMessage(sessionId: string, clientMessageId: string): Message {
  const existing = findAssistantMessageByClientMessageId(sessionId, clientMessageId);
  if (existing) {
    if (existing.status === 'error') {
      const db = getDb();
      db.prepare(`
        UPDATE messages
        SET content = '',
            token_usage = NULL,
            status = 'streaming',
            content_format_version = 2,
            completed_at = NULL,
            persisted_revision = 0
        WHERE id = ?
      `).run(existing.id);
      replaceMessageParts(existing.id, sessionId, []);
      updateSessionTimestamp(sessionId);
      return getMessageById(existing.id);
    }

    return existing;
  }

  return addMessage(sessionId, 'assistant', '', null, clientMessageId, {
    status: 'streaming',
    contentFormatVersion: 2,
    persistedRevision: 0,
  });
}

export function upsertAssistantMessage(
  sessionId: string,
  clientMessageId: string,
  content: string,
  tokenUsage?: string | null,
  options?: AddMessageOptions,
): Message {
  const existing = findAssistantMessageByClientMessageId(sessionId, clientMessageId);
  if (existing) {
    return updateMessageRecord(existing.id, content, {
      tokenUsage: tokenUsage ?? null,
      status: options?.status ?? existing.status ?? null,
      contentFormatVersion: options?.contentFormatVersion ?? existing.content_format_version ?? null,
      completedAt: options?.completedAt ?? existing.completed_at ?? null,
      persistedRevision: options?.persistedRevision ?? existing.persisted_revision ?? null,
    });
  }

  return addMessage(sessionId, 'assistant', content, tokenUsage ?? null, clientMessageId, options);
}

export function upsertUserMessage(
  sessionId: string,
  clientMessageId: string,
  content: string,
  tokenUsage?: string | null,
  options?: AddMessageOptions,
): Message {
  const existing = findUserMessageByClientMessageId(sessionId, clientMessageId);
  if (existing) {
    assertUserMessageIdempotency(existing, content);
    return updateMessageRecord(existing.id, content, {
      tokenUsage: tokenUsage ?? null,
      status: options?.status ?? existing.status ?? null,
      contentFormatVersion: options?.contentFormatVersion ?? existing.content_format_version ?? null,
      completedAt: options?.completedAt ?? existing.completed_at ?? null,
      persistedRevision: options?.persistedRevision ?? existing.persisted_revision ?? null,
    });
  }

  return addMessage(sessionId, 'user', content, tokenUsage ?? null, clientMessageId, options);
}

export function updateMessageContent(messageId: string, content: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, messageId);
  return result.changes;
}

export function deleteMessageRecord(messageId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
  return result.changes > 0;
}

export function replaceMessageParts(messageId: string, sessionId: string, parts: MessagePartInput[]): void {
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO message_parts (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction((entries: MessagePartInput[]) => {
    db.prepare('DELETE FROM message_parts WHERE message_id = ?').run(messageId);
    for (const part of entries) {
      insert.run(
        sessionId,
        messageId,
        part.partType,
        part.content,
        part.metadata ? JSON.stringify(part.metadata) : null,
        now,
        part.partKey ?? null,
        part.partIndex ?? null,
        part.revision ?? null,
        part.isFinal === undefined || part.isFinal === null ? null : (part.isFinal ? 1 : 0),
        part.updatedAt ?? null,
      );
    }
  });

  transaction(parts);
}

export function upsertMessageParts(
  messageId: string,
  sessionId: string,
  parts: MessagePartInput[],
  options?: { pruneMissingPartKeys?: boolean },
): void {
  const db = getDb();
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO message_parts (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, part_key) WHERE part_key IS NOT NULL DO UPDATE SET
      part_type = excluded.part_type,
      content = excluded.content,
      metadata = excluded.metadata,
      part_index = excluded.part_index,
      revision = excluded.revision,
      is_final = excluded.is_final,
      updated_at = excluded.updated_at`
  );
  const insertWithoutKey = db.prepare(
    `INSERT INTO message_parts (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction((entries: MessagePartInput[]) => {
    const keyedPartKeys: string[] = [];

    for (const part of entries) {
      const partKey = typeof part.partKey === 'string' && part.partKey.trim().length > 0
        ? part.partKey
        : null;
      const params = [
        sessionId,
        messageId,
        part.partType,
        part.content,
        part.metadata ? JSON.stringify(part.metadata) : null,
        now,
        partKey,
        part.partIndex ?? null,
        part.revision ?? null,
        part.isFinal === undefined || part.isFinal === null ? null : (part.isFinal ? 1 : 0),
        part.updatedAt ?? now,
      ] as const;

      if (partKey) {
        keyedPartKeys.push(partKey);
        upsert.run(...params);
      } else {
        insertWithoutKey.run(...params);
      }
    }

    if (!options?.pruneMissingPartKeys) {
      return;
    }

    if (keyedPartKeys.length === 0) {
      db.prepare('DELETE FROM message_parts WHERE message_id = ? AND part_key IS NOT NULL').run(messageId);
      return;
    }

    const placeholders = keyedPartKeys.map(() => '?').join(', ');
    db.prepare(
      `DELETE FROM message_parts
       WHERE message_id = ?
         AND part_key IS NOT NULL
         AND part_key NOT IN (${placeholders})`
    ).run(messageId, ...keyedPartKeys);
  });

  transaction(parts);
}

export function getMessageParts(messageId: string): MessagePartRecord[] {
  const db = getDb();
  return db.prepare(
    `SELECT
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
    WHERE message_id = ?
    ORDER BY COALESCE(part_index, id) ASC, id ASC`
  ).all(messageId) as MessagePartRecord[];
}

export function getSessionRuntimeState(sessionId: string): SessionRuntimeStateRecord | undefined {
  const db = getDb();
  return db.prepare(
    'SELECT session_id, status, pending_permissions, generation_queue, last_event_id, updated_at FROM session_runtime_state WHERE session_id = ?'
  ).get(sessionId) as SessionRuntimeStateRecord | undefined;
}

export function upsertSessionRuntimeState(sessionId: string, patch: SessionRuntimeStatePatch): void {
  const db = getDb();
  const current = getSessionRuntimeState(sessionId);
  const nextStatus = patch.status ?? current?.status ?? 'idle';
  const pendingPermissions = JSON.stringify(patch.pendingPermissions ?? (current?.pending_permissions ? JSON.parse(current.pending_permissions) : []));
  const generationQueue = JSON.stringify(patch.generationQueue ?? (current?.generation_queue ? JSON.parse(current.generation_queue) : []));
  const lastEventId = patch.lastEventId ?? current?.last_event_id ?? null;
  const updatedAt = Date.now();

  db.prepare(
    `INSERT INTO session_runtime_state (session_id, status, pending_permissions, generation_queue, last_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       status = excluded.status,
       pending_permissions = excluded.pending_permissions,
       generation_queue = excluded.generation_queue,
       last_event_id = excluded.last_event_id,
       updated_at = excluded.updated_at`
  ).run(sessionId, nextStatus, pendingPermissions, generationQueue, lastEventId, updatedAt);
}

/**
 * Find the most recent assistant message in a session that contains a given text snippet,
 * update its content, and return the real message ID. Used as fallback when the frontend
 * only has a temporary message ID.
 */
export function updateMessageBySessionAndHint(
  sessionId: string,
  promptHint: string,
  content: string,
): { changes: number; messageId?: string } {
  const db = getDb();
  // Find the latest assistant message containing the prompt hint within an image-gen-request block
  const row = db.prepare(
    "SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' AND content LIKE '%image-gen-request%' AND content LIKE ? ORDER BY created_at DESC LIMIT 1"
  ).get(sessionId, `%${promptHint.slice(0, 60)}%`) as { id: string } | undefined;

  if (!row) return { changes: 0 };

  const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, row.id);
  return { changes: result.changes, messageId: row.id };
}

export function clearSessionMessages(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  // Reset SDK session ID so next message starts fresh
  db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run('', sessionId);
}

function hydrateMessageRows(rows: PersistedMessageRow[]): Message[] {
  if (rows.length === 0) {
    return rows;
  }

  const db = getDb();
  const messageIds = rows.map((row) => row.id);
  const placeholders = messageIds.map(() => '?').join(', ');
  const allParts = db.prepare(
    `SELECT
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
    WHERE message_id IN (${placeholders})
    ORDER BY message_id ASC, COALESCE(part_index, id) ASC, id ASC`
  ).all(...messageIds) as MessagePartRecord[];

  const partsByMessageId = new Map<string, MessagePartRecord[]>();
  for (const part of allParts) {
    const bucket = partsByMessageId.get(part.message_id);
    if (bucket) {
      bucket.push(part);
    } else {
      partsByMessageId.set(part.message_id, [part]);
    }
  }

  return rows.map((row) => {
    const parts = partsByMessageId.get(row.id) ?? [];
    if (parts.length === 0) {
      return row;
    }
    return {
      ...row,
      content: resolveMessageContentFromParts({
        content: row.content,
        status: row.status,
        parts,
      }),
    };
  });
}

// ==========================================
// Settings Operations
// ==========================================

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getAllSettings(): SettingsMap {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: SettingsMap = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ==========================================
// Session Status Operations
// ==========================================

export function updateSessionStatus(id: string, status: 'active' | 'archived'): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET status = ? WHERE id = ?').run(status, id);
}

// ==========================================
// Task Operations
// ==========================================

export function getTasksBySession(sessionId: string): TaskItem[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY sort_order ASC, created_at ASC').all(sessionId) as TaskItem[];
}

export function getTask(id: string): TaskItem | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem | undefined;
}

export function createTask(sessionId: string, title: string, description?: string): TaskItem {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO tasks (id, session_id, title, status, description, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, title, 'pending', description || null, 'user', now, now);

  return getTask(id)!;
}

export function updateTask(id: string, updates: { title?: string; status?: TaskStatus; description?: string }): TaskItem | undefined {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const existing = getTask(id);
  if (!existing) return undefined;

  const title = updates.title ?? existing.title;
  const status = updates.status ?? existing.status;
  const description = updates.description !== undefined ? updates.description : existing.description;

  db.prepare(
    'UPDATE tasks SET title = ?, status = ?, description = ?, updated_at = ? WHERE id = ?'
  ).run(title, status, description, now, id);

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Sync SDK tasks (from TodoWrite tool) into the tasks table.
 * Replace-all strategy: delete all source='sdk' tasks for this session,
 * then insert the new list. User-created tasks (source='user') are untouched.
 */
export function syncSdkTasks(
  sessionId: string,
  todos: Array<{ id: string; content: string; status: string; activeForm?: string }>
): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Map SDK status to local TaskStatus
  const mapStatus = (s: string): TaskStatus => {
    switch (s) {
      case 'completed': return 'completed';
      case 'in_progress': return 'in_progress';
      case 'pending': return 'pending';
      default: return 'pending';
    }
  };

  console.log('[db] syncSdkTasks:', sessionId, 'todos count:', todos.length);

  const txn = db.transaction(() => {
    // Delete all SDK-sourced tasks for this session
    db.prepare("DELETE FROM tasks WHERE session_id = ? AND source = 'sdk'").run(sessionId);

    // Insert new SDK tasks with stable sort_order
    const insert = db.prepare(
      'INSERT INTO tasks (id, session_id, title, status, description, source, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      const taskId = `sdk-${sessionId}-${todo.id}`;
      insert.run(taskId, sessionId, todo.content, mapStatus(todo.status), todo.activeForm || null, 'sdk', i, now, now);
    }
  });
  txn();
}

// ==========================================
// API Provider Operations
// ==========================================

export function getAllProviders(): ApiProvider[] {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers ORDER BY sort_order ASC, created_at ASC').all() as ApiProvider[];
}

export function getProvider(id: string): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider | undefined;
}

export function getActiveProvider(): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE is_active = 1 LIMIT 1').get() as ApiProvider | undefined;
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Get max sort_order to append at end
  const maxRow = db.prepare('SELECT MAX(sort_order) as max_order FROM api_providers').get() as { max_order: number | null };
  const sortOrder = (maxRow.max_order ?? -1) + 1;

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.provider_type || 'anthropic',
    data.base_url || '',
    data.api_key || '',
    0,
    sortOrder,
    data.extra_env || '{}',
    data.notes || '',
    now,
    now,
  );

  return getProvider(id)!;
}

export function updateProvider(id: string, data: UpdateProviderRequest): ApiProvider | undefined {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const name = data.name ?? existing.name;
  const providerType = data.provider_type ?? existing.provider_type;
  const baseUrl = data.base_url ?? existing.base_url;
  const apiKey = data.api_key ?? existing.api_key;
  const extraEnv = data.extra_env ?? existing.extra_env;
  const notes = data.notes ?? existing.notes;
  const sortOrder = data.sort_order ?? existing.sort_order;

  db.prepare(
    'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, notes = ?, sort_order = ?, updated_at = ? WHERE id = ?'
  ).run(name, providerType, baseUrl, apiKey, extraEnv, notes, sortOrder, now, id);

  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function activateProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
  });
  transaction();
  return true;
}

export function deactivateAllProviders(): void {
  const db = getDb();
  db.prepare('UPDATE api_providers SET is_active = 0').run();
}
