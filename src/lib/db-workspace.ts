import Database from 'better-sqlite3';
import crypto from 'crypto';
import type { ChatSession, Worktree } from '@/types';
import { getDb } from './db-core';
import { isManagedWorktreeSubPath } from './workspace-utils';

/**
 * Get timeline events for the workspace
 * Aggregates sessions, messages, and tool executions into a unified timeline
 */
export function getTimelineEvents(days: number = 30): {
  events: Array<{
    id: string;
    type: 'session_created' | 'session_updated' | 'message_sent' | 'tool_executed';
    timestamp: string;
    sessionId: string;
    sessionTitle: string;
    workspacePath: string;
    metadata: Record<string, unknown>;
  }>;
} {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString();

  const events: Array<{
    id: string;
    type: 'session_created' | 'session_updated' | 'message_sent' | 'tool_executed';
    timestamp: string;
    sessionId: string;
    sessionTitle: string;
    workspacePath: string;
    metadata: Record<string, unknown>;
  }> = [];

  // 1. Session created events
  const sessionCreatedStmt = db.prepare(`
    SELECT
      id,
      title,
      working_directory,
      created_at,
      session_type,
      model
    FROM chat_sessions
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `);

  const sessionCreatedRows = sessionCreatedStmt.all(cutoffStr) as Array<{
    id: string;
    title: string;
    working_directory: string;
    created_at: string;
    session_type: string;
    model: string;
  }>;

  for (const row of sessionCreatedRows) {
    events.push({
      id: `session_created_${row.id}`,
      type: 'session_created',
      timestamp: row.created_at,
      sessionId: row.id,
      sessionTitle: row.title,
      workspacePath: row.working_directory,
      metadata: {
        sessionType: row.session_type,
        model: row.model,
      },
    });
  }

  // 2. Session updated events (only if updated_at != created_at)
  const sessionUpdatedStmt = db.prepare(`
    SELECT
      id,
      title,
      working_directory,
      updated_at,
      session_type
    FROM chat_sessions
    WHERE updated_at >= ?
      AND updated_at != created_at
    ORDER BY updated_at DESC
  `);

  const sessionUpdatedRows = sessionUpdatedStmt.all(cutoffStr) as Array<{
    id: string;
    title: string;
    working_directory: string;
    updated_at: string;
    session_type: string;
  }>;

  for (const row of sessionUpdatedRows) {
    events.push({
      id: `session_updated_${row.id}_${row.updated_at}`,
      type: 'session_updated',
      timestamp: row.updated_at,
      sessionId: row.id,
      sessionTitle: row.title,
      workspacePath: row.working_directory,
      metadata: {
        sessionType: row.session_type,
      },
    });
  }

  // 3. Message sent events
  const messageStmt = db.prepare(`
    SELECT
      m.id,
      m.session_id,
      m.role,
      m.created_at,
      s.title,
      s.working_directory
    FROM messages m
    JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.created_at >= ?
    ORDER BY m.created_at DESC
    LIMIT 500
  `);

  const messageRows = messageStmt.all(cutoffStr) as Array<{
    id: string;
    session_id: string;
    role: string;
    created_at: string;
    title: string;
    working_directory: string;
  }>;

  for (const row of messageRows) {
    events.push({
      id: `message_${row.id}`,
      type: 'message_sent',
      timestamp: row.created_at,
      sessionId: row.session_id,
      sessionTitle: row.title,
      workspacePath: row.working_directory,
      metadata: {
        role: row.role,
      },
    });
  }

  // 4. Tool executed events (from message content)
  const toolMessagesStmt = db.prepare(`
    SELECT
      m.id,
      m.session_id,
      m.content,
      m.created_at,
      s.title,
      s.working_directory
    FROM messages m
    JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.created_at >= ?
      AND m.role = 'assistant'
      AND m.content LIKE '%tool_use%'
    ORDER BY m.created_at DESC
    LIMIT 500
  `);

  const toolMessageRows = toolMessagesStmt.all(cutoffStr) as Array<{
    id: string;
    session_id: string;
    content: string;
    created_at: string;
    title: string;
    working_directory: string;
  }>;

  for (const row of toolMessageRows) {
    try {
      const content = JSON.parse(row.content);
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            events.push({
              id: `tool_${block.id}`,
              type: 'tool_executed',
              timestamp: row.created_at,
              sessionId: row.session_id,
              sessionTitle: row.title,
              workspacePath: row.working_directory,
              metadata: {
                toolName: block.name,
                toolUseId: block.id,
              },
            });
          }
        }
      }
    } catch {
      // Skip invalid JSON
      continue;
    }
  }

  // Sort all events by timestamp (descending)
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { events };
}

/**
 * Get work graph data for visualization
 * Analyzes relationships between sessions, repos, and files
 */
export function getWorkGraph(workspacePath?: string): {
  nodes: Array<{
    id: string;
    type: 'session' | 'repo' | 'file';
    label: string;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'modified' | 'referenced' | 'related';
  }>;
} {
  const db = getDb();
  const nodes: Array<{
    id: string;
    type: 'session' | 'repo' | 'file';
    label: string;
    metadata: Record<string, unknown>;
  }> = [];
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    type: 'modified' | 'referenced' | 'related';
  }> = [];

  // Build WHERE clause for workspace filtering
  const whereClause = workspacePath ? 'WHERE s.working_directory = ?' : '';
  const params = workspacePath ? [workspacePath] : [];

  // 1. Get sessions as nodes
  const sessionsStmt = db.prepare(`
    SELECT
      id,
      title,
      working_directory,
      session_type,
      model,
      updated_at
    FROM chat_sessions s
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT 50
  `);

  const sessionRows = sessionsStmt.all(...params) as Array<{
    id: string;
    title: string;
    working_directory: string;
    session_type: string;
    model: string;
    updated_at: string;
  }>;

  for (const row of sessionRows) {
    nodes.push({
      id: `session_${row.id}`,
      type: 'session',
      label: row.title,
      metadata: {
        sessionId: row.id,
        sessionType: row.session_type,
        model: row.model,
        workspacePath: row.working_directory,
        updatedAt: row.updated_at,
      },
    });

    // Add edge from session to workspace (repo)
    const repoId = `repo_${row.working_directory}`;
    if (!nodes.find(n => n.id === repoId)) {
      nodes.push({
        id: repoId,
        type: 'repo',
        label: row.working_directory.split('/').pop() || row.working_directory,
        metadata: {
          path: row.working_directory,
        },
      });
    }

    edges.push({
      id: `session_${row.id}_to_${repoId}`,
      source: `session_${row.id}`,
      target: repoId,
      type: 'related',
    });
  }

  // 2. Extract file references from tool executions
  const toolMessagesStmt = db.prepare(`
    SELECT
      m.id,
      m.session_id,
      m.content,
      s.working_directory
    FROM messages m
    JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.role = 'assistant'
      AND m.content LIKE '%tool_use%'
      ${workspacePath ? 'AND s.working_directory = ?' : ''}
    ORDER BY m.created_at DESC
    LIMIT 200
  `);

  const toolMessageRows = toolMessagesStmt.all(...params) as Array<{
    id: string;
    session_id: string;
    content: string;
    working_directory: string;
  }>;

  const fileSet = new Set<string>();

  for (const row of toolMessageRows) {
    try {
      const content = JSON.parse(row.content);
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && block.input) {
            // Extract file paths from tool inputs
            const input = block.input;
            if (input.file_path) {
              fileSet.add(input.file_path);
            }
            if (input.path) {
              fileSet.add(input.path);
            }
            if (input.paths && Array.isArray(input.paths)) {
              input.paths.forEach((p: string) => fileSet.add(p));
            }
          }
        }
      }
    } catch {
      // Skip invalid JSON
      continue;
    }
  }

  // Add file nodes and edges (limit to top 30 files)
  const files = Array.from(fileSet).slice(0, 30);
  for (const filePath of files) {
    const fileId = `file_${filePath}`;
    nodes.push({
      id: fileId,
      type: 'file',
      label: filePath.split('/').pop() || filePath,
      metadata: {
        path: filePath,
      },
    });

    // Find sessions that referenced this file
    for (const row of toolMessageRows) {
      try {
        const content = JSON.parse(row.content);
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && block.input) {
              const input = block.input;
              const referencedPaths = [
                input.file_path,
                input.path,
                ...(input.paths || []),
              ].filter(Boolean);

              if (referencedPaths.includes(filePath)) {
                edges.push({
                  id: `session_${row.session_id}_to_${fileId}`,
                  source: `session_${row.session_id}`,
                  target: fileId,
                  type: 'modified',
                });
                break;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }
  }

  return { nodes, edges };
}

// ==========================================
// Worktree Operations
// ==========================================

const WORKTREE_LIMIT_PER_WORKSPACE = 8;
const WORKTREE_LIMIT_GLOBAL = 20;

/** Ensure the worktrees table + worktree_id column exist (handles stale DB from dev hot-reload) */
export function ensureWorktreeSchema(database: Database.Database): void {
  // Check if worktrees table exists and has the expected schema
  const wtCols = database.prepare("PRAGMA table_info(worktrees)").all() as { name: string }[];
  const wtColNames = wtCols.map(c => c.name);

  if (wtCols.length > 0 && !wtColNames.includes('workspace_path')) {
    // Old schema detected (has workspace_id + path instead of workspace_path + worktree_path).
    // Migrate: rename old table, create new, copy data, drop old.
    database.exec(`ALTER TABLE worktrees RENAME TO _worktrees_old`);
    database.exec(`DROP INDEX IF EXISTS idx_worktrees_workspace_id`);
    database.exec(`DROP INDEX IF EXISTS idx_worktrees_path`);
    database.exec(`
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_path);
    `);
    // Migrate data: join with workspaces table to resolve workspace_id → root_path
    const hasWorkspacesTable = (database.prepare(
      "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='workspaces'"
    ).get() as { c: number }).c > 0;

    if (hasWorkspacesTable) {
      database.exec(`
        INSERT OR IGNORE INTO worktrees (id, workspace_path, worktree_path, branch, is_default, name, created_at, updated_at)
        SELECT o.id, COALESCE(w.root_path, ''), o.path, o.branch, o.is_default, o.name, o.created_at, o.updated_at
        FROM _worktrees_old o
        LEFT JOIN workspaces w ON o.workspace_id = w.id
      `);
    }
    database.exec(`DROP TABLE _worktrees_old`);
  } else if (wtCols.length === 0) {
    // Table doesn't exist at all — create it
    database.exec(`
      CREATE TABLE IF NOT EXISTS worktrees (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_path);
    `);
  }

  // Ensure worktree_id column on chat_sessions
  const cols = database.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'worktree_id')) {
    database.exec("ALTER TABLE chat_sessions ADD COLUMN worktree_id TEXT NOT NULL DEFAULT ''");
  }

  cleanupInvalidManagedWorkspaceWorktrees(database);
}

function cleanupInvalidManagedWorkspaceWorktrees(database: Database.Database): void {
  const invalidIds = (
    database.prepare('SELECT id, workspace_path FROM worktrees').all() as Array<{
      id: string;
      workspace_path: string;
    }>
  )
    .filter((row) => isManagedWorktreeSubPath(row.workspace_path || ''))
    .map((row) => row.id);

  if (invalidIds.length === 0) {
    return;
  }

  const clearSessionWorktreeStmt = database.prepare(
    "UPDATE chat_sessions SET worktree_id = '' WHERE worktree_id = ?"
  );
  const deleteWorktreeStmt = database.prepare('DELETE FROM worktrees WHERE id = ?');

  const cleanup = database.transaction((ids: string[]) => {
    for (const id of ids) {
      clearSessionWorktreeStmt.run(id);
      deleteWorktreeStmt.run(id);
    }
  });

  cleanup(invalidIds);
}

function rowToWorktree(row: Record<string, unknown>): Worktree {
  return {
    id: row.id as string,
    workspace_path: row.workspace_path as string,
    worktree_path: row.worktree_path as string,
    branch: row.branch as string,
    is_default: (row.is_default as number) === 1,
    name: row.name as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function countBillableWorktrees(
  database: Database.Database,
  workspacePath?: string,
): number {
  if (workspacePath) {
    const row = database.prepare(
      'SELECT COUNT(*) as count FROM worktrees WHERE workspace_path = ? AND is_default = 0'
    ).get(workspacePath) as { count: number };
    return row.count;
  }

  const row = database.prepare(
    'SELECT COUNT(*) as count FROM worktrees WHERE is_default = 0'
  ).get() as { count: number };
  return row.count;
}

export function createWorktreeRecord(
  workspacePath: string,
  worktreePath: string,
  branch: string,
  isDefault: boolean,
  name: string,
): Worktree {
  const database = getDb();
  ensureWorktreeSchema(database);

  // Enforce limits
  if (!isDefault) {
    const wsCount = countBillableWorktrees(database, workspacePath);
    if (wsCount >= WORKTREE_LIMIT_PER_WORKSPACE) {
      throw new Error(`Workspace worktree limit reached (max ${WORKTREE_LIMIT_PER_WORKSPACE})`);
    }
    const globalCount = countBillableWorktrees(database);
    if (globalCount >= WORKTREE_LIMIT_GLOBAL) {
      throw new Error(`Global worktree limit reached (max ${WORKTREE_LIMIT_GLOBAL})`);
    }
  }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  database.prepare(
    'INSERT INTO worktrees (id, workspace_path, worktree_path, branch, is_default, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, workspacePath, worktreePath, branch, isDefault ? 1 : 0, name, now, now);

  return {
    id,
    workspace_path: workspacePath,
    worktree_path: worktreePath,
    branch,
    is_default: isDefault,
    name,
    created_at: now,
    updated_at: now,
  };
}

export function getWorktreesByWorkspace(workspacePath: string): Worktree[] {
  const database = getDb();
  ensureWorktreeSchema(database);
  const rows = database.prepare(
    'SELECT * FROM worktrees WHERE workspace_path = ? ORDER BY is_default DESC, created_at ASC'
  ).all(workspacePath) as Record<string, unknown>[];
  return rows.map(rowToWorktree);
}

export function getWorktreeById(id: string): Worktree | undefined {
  const database = getDb();
  ensureWorktreeSchema(database);
  const row = database.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToWorktree(row) : undefined;
}

export function getWorktreeByPath(worktreePath: string): Worktree | undefined {
  const database = getDb();
  ensureWorktreeSchema(database);
  const row = database.prepare('SELECT * FROM worktrees WHERE worktree_path = ?').get(worktreePath) as Record<string, unknown> | undefined;
  return row ? rowToWorktree(row) : undefined;
}

export function deleteWorktreeRecord(id: string): boolean {
  const database = getDb();
  ensureWorktreeSchema(database);
  const wt = database.prepare('SELECT is_default FROM worktrees WHERE id = ?').get(id) as { is_default: number } | undefined;
  if (!wt) return false;
  if (wt.is_default === 1) {
    throw new Error('Cannot delete the default worktree');
  }
  const result = database.prepare('DELETE FROM worktrees WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getWorktreeCount(workspacePath?: string): number {
  const database = getDb();
  ensureWorktreeSchema(database);
  return countBillableWorktrees(database, workspacePath);
}

export function ensureDefaultWorktree(workspacePath: string, branch: string): Worktree {
  const database = getDb();
  ensureWorktreeSchema(database);
  const existing = database.prepare(
    'SELECT * FROM worktrees WHERE workspace_path = ? AND is_default = 1'
  ).get(workspacePath) as Record<string, unknown> | undefined;
  if (existing) {
    const existingName = typeof existing.name === 'string' ? existing.name.trim().toLowerCase() : '';
    const shouldUpdateBranch = Boolean(branch) && existing.branch !== branch;
    const shouldBackfillName = Boolean(branch) && (existingName === '' || existingName === 'default');

    if (shouldUpdateBranch && shouldBackfillName) {
      database.prepare(
        "UPDATE worktrees SET branch = ?, name = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(branch, branch, existing.id);
      existing.branch = branch;
      existing.name = branch;
    } else if (shouldUpdateBranch) {
      database.prepare(
        "UPDATE worktrees SET branch = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(branch, existing.id);
      existing.branch = branch;
    } else if (shouldBackfillName) {
      database.prepare(
        "UPDATE worktrees SET name = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(branch, existing.id);
      existing.name = branch;
    }
    return rowToWorktree(existing);
  }
  // Check if a record with this worktree_path already exists (non-default)
  const byPath = database.prepare(
    'SELECT * FROM worktrees WHERE worktree_path = ?'
  ).get(workspacePath) as Record<string, unknown> | undefined;
  if (byPath) {
    const existingName = typeof byPath.name === 'string' ? byPath.name.trim().toLowerCase() : '';
    const shouldBackfillName = Boolean(branch) && (existingName === '' || existingName === 'default');

    // Promote it to default
    if (shouldBackfillName) {
      database.prepare(
        "UPDATE worktrees SET is_default = 1, workspace_path = ?, name = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(workspacePath, branch, byPath.id);
      byPath.name = branch;
    } else {
      database.prepare(
        "UPDATE worktrees SET is_default = 1, workspace_path = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(workspacePath, byPath.id);
    }
    byPath.is_default = 1;
    byPath.workspace_path = workspacePath;
    return rowToWorktree(byPath);
  }
  return createWorktreeRecord(workspacePath, workspacePath, branch, true, branch || 'default');
}

export function getSessionsByWorktreeId(worktreeId: string): ChatSession[] {
  const database = getDb();
  ensureWorktreeSchema(database);
  return database.prepare(
    'SELECT * FROM chat_sessions WHERE worktree_id = ? ORDER BY updated_at DESC'
  ).all(worktreeId) as ChatSession[];
}

export { WORKTREE_LIMIT_PER_WORKSPACE, WORKTREE_LIMIT_GLOBAL };
