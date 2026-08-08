import Database from 'better-sqlite3';
import crypto from 'crypto';

import { expirePermissionRequestsInDatabase } from '../db-permission-requests';
import {
  ENSURE_API_PROVIDERS_TABLE_SQL,
  ENSURE_CONTEXT_BUDGET_EVENTS_TABLE_SQL,
  ENSURE_MEDIA_GENERATIONS_TABLE_SQL,
  ENSURE_MEDIA_JOBS_TABLES_SQL,
  ENSURE_PERMISSION_REQUESTS_TABLE_SQL,
  ENSURE_RUNTIME_LOCKS_TABLE_SQL,
  ENSURE_SESSION_CHANGE_LOG_SQL,
  ENSURE_TASKS_TABLE_SQL,
} from './migration-sql';

export function migrateDb(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(chat_sessions)").all() as { name: string }[];
  const colNames = columns.map(c => c.name);

  if (!colNames.includes('model')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('session_type')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'chat'");
    db.exec("UPDATE chat_sessions SET session_type = 'chat' WHERE session_type = ''");
  }
  if (!colNames.includes('system_prompt')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('sdk_session_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN sdk_session_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('project_name')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN project_name TEXT NOT NULL DEFAULT ''");
    // Backfill project_name from working_directory for existing rows
    db.exec(`
      UPDATE chat_sessions
      SET project_name = CASE
        WHEN working_directory != '' THEN REPLACE(REPLACE(working_directory, RTRIM(working_directory, REPLACE(working_directory, '/', '')), ''), '/', '')
        ELSE ''
      END
      WHERE project_name = ''
    `);
  }
  if (!colNames.includes('status')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!colNames.includes('mode')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'code'");
  }
  if (!colNames.includes('provider_name')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN provider_name TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('provider_id')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('sdk_cwd')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN sdk_cwd TEXT NOT NULL DEFAULT ''");
    // Backfill sdk_cwd from working_directory for existing sessions
    db.exec("UPDATE chat_sessions SET sdk_cwd = working_directory WHERE sdk_cwd = '' AND working_directory != ''");
  }
  if (!colNames.includes('runtime_status')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_status TEXT NOT NULL DEFAULT 'idle'");
  }
  if (!colNames.includes('runtime_updated_at')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_updated_at TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('runtime_error')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN runtime_error TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.includes('assistant_runtime')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN assistant_runtime TEXT NOT NULL DEFAULT 'claude_code'");
  }
  if (!colNames.includes('assistant_runtime_version')) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN assistant_runtime_version TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_runtime_status ON chat_sessions(runtime_status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_type_updated_at ON chat_sessions(session_type, updated_at DESC)");

  // Migrate is_active provider to default_provider_id setting
  const defaultProviderSetting = db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'").get() as { value: string } | undefined;
  if (!defaultProviderSetting) {
    const activeProvider = db.prepare('SELECT id FROM api_providers WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined;
    if (activeProvider) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(activeProvider.id);
    }
  }

  const msgColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const msgColNames = msgColumns.map(c => c.name);

  if (!msgColNames.includes('token_usage')) {
    db.exec("ALTER TABLE messages ADD COLUMN token_usage TEXT");
  }
  if (!msgColNames.includes('client_message_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN client_message_id TEXT');
  }
  if (!msgColNames.includes('status')) {
    db.exec('ALTER TABLE messages ADD COLUMN status TEXT');
  }
  if (!msgColNames.includes('content_format_version')) {
    db.exec('ALTER TABLE messages ADD COLUMN content_format_version INTEGER');
  }
  if (!msgColNames.includes('completed_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN completed_at TEXT');
  }
  if (!msgColNames.includes('persisted_revision')) {
    db.exec('ALTER TABLE messages ADD COLUMN persisted_revision INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_client_message_id ON messages(client_message_id)');

  const messagePartsTable = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_parts'"
  ).get() as { sql?: string } | undefined;
  const messagePartsSql = messagePartsTable?.sql || '';
  if (messagePartsSql && !messagePartsSql.includes("'reasoning'")) {
    db.exec('DROP TABLE IF EXISTS message_parts_reasoning_backup');
    db.exec('ALTER TABLE message_parts RENAME TO message_parts_reasoning_backup');
    db.exec(`
      CREATE TABLE message_parts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        part_type TEXT NOT NULL CHECK(part_type IN ('text', 'reasoning', 'tool_use', 'tool_result')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        part_key TEXT,
        part_index INTEGER,
        revision INTEGER,
        is_final INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
      INSERT INTO message_parts (id, session_id, message_id, part_type, content, metadata, created_at)
      SELECT id, session_id, message_id, part_type, content, metadata, created_at
      FROM message_parts_reasoning_backup
    `);
    db.exec('DROP TABLE message_parts_reasoning_backup');
    db.exec('CREATE INDEX IF NOT EXISTS idx_message_parts_session_id ON message_parts(session_id, created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id)');
  }

  const messagePartColumns = db.prepare("PRAGMA table_info(message_parts)").all() as { name: string }[];
  const messagePartColNames = messagePartColumns.map(c => c.name);
  if (!messagePartColNames.includes('part_key')) {
    db.exec('ALTER TABLE message_parts ADD COLUMN part_key TEXT');
  }
  if (!messagePartColNames.includes('part_index')) {
    db.exec('ALTER TABLE message_parts ADD COLUMN part_index INTEGER');
  }
  if (!messagePartColNames.includes('revision')) {
    db.exec('ALTER TABLE message_parts ADD COLUMN revision INTEGER');
  }
  if (!messagePartColNames.includes('is_final')) {
    db.exec('ALTER TABLE message_parts ADD COLUMN is_final INTEGER');
  }
  if (!messagePartColNames.includes('updated_at')) {
    db.exec('ALTER TABLE message_parts ADD COLUMN updated_at INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_part_index ON message_parts(message_id, part_index)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_message_parts_message_id_part_key ON message_parts(message_id, part_key) WHERE part_key IS NOT NULL');
  dedupeMessagesByClientMessageId(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_role_client_id
    ON messages(session_id, role, client_message_id)
    WHERE client_message_id IS NOT NULL
  `);

  const runtimeStateTable = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_runtime_state'"
  ).get() as { sql?: string } | undefined;
  const runtimeStateSql = runtimeStateTable?.sql || '';
  if (runtimeStateSql && !runtimeStateSql.includes("'stopping'")) {
    db.exec('DROP TABLE IF EXISTS session_runtime_state_stopping_backup');
    db.exec('ALTER TABLE session_runtime_state RENAME TO session_runtime_state_stopping_backup');
    db.exec(`
      CREATE TABLE session_runtime_state (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'waiting_permission', 'stopping', 'error')),
        pending_permissions TEXT NOT NULL DEFAULT '[]',
        generation_queue TEXT NOT NULL DEFAULT '[]',
        last_event_id TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
      INSERT INTO session_runtime_state (
        session_id,
        status,
        pending_permissions,
        generation_queue,
        last_event_id,
        updated_at
      )
      SELECT
        session_id,
        CASE
          WHEN status IN ('idle', 'running', 'waiting_permission', 'stopping', 'error') THEN status
          ELSE 'error'
        END,
        pending_permissions,
        generation_queue,
        last_event_id,
        updated_at
      FROM session_runtime_state_stopping_backup
    `);
    db.exec('DROP TABLE session_runtime_state_stopping_backup');
  }

  // Ensure tasks table exists for databases created before this migration
  db.exec(ENSURE_TASKS_TABLE_SQL);

  // Add source column to tasks table (user vs sdk)
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = taskColumns.map(c => c.name);
  if (!taskColNames.includes('source')) {
    db.exec("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  }
  if (!taskColNames.includes('sort_order')) {
    db.exec("ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  // Ensure api_providers table exists for databases created before this migration
  db.exec(ENSURE_API_PROVIDERS_TABLE_SQL);

  // Ensure media_generations table exists for databases created before this migration
  db.exec(ENSURE_MEDIA_GENERATIONS_TABLE_SQL);

  // Ensure media_jobs tables exist for databases created before this migration
  db.exec(ENSURE_MEDIA_JOBS_TABLES_SQL);

  // Ensure context_budget_events exists for context budget observability
  db.exec(ENSURE_CONTEXT_BUDGET_EVENTS_TABLE_SQL);
  const contextBudgetEventColumns = db.prepare("PRAGMA table_info(context_budget_events)").all() as { name: string }[];
  const contextBudgetEventColumnNames = contextBudgetEventColumns.map((column) => column.name);
  if (contextBudgetEventColumnNames.length > 0 && !contextBudgetEventColumnNames.includes('official_compact_success')) {
    db.exec('ALTER TABLE context_budget_events ADD COLUMN official_compact_success INTEGER NOT NULL DEFAULT 0');
  }
  if (contextBudgetEventColumnNames.length > 0 && !contextBudgetEventColumnNames.includes('compact_retry_success')) {
    db.exec('ALTER TABLE context_budget_events ADD COLUMN compact_retry_success INTEGER NOT NULL DEFAULT 0');
  }
  if (contextBudgetEventColumnNames.length > 0 && !contextBudgetEventColumnNames.includes('recovery_duration_ms')) {
    db.exec('ALTER TABLE context_budget_events ADD COLUMN recovery_duration_ms INTEGER');
  }

  // Add favorited column to media_generations if missing
  try {
    db.exec("ALTER TABLE media_generations ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists
  }

  // Recover stale jobs: mark 'running' jobs as 'paused' after process restart
  db.exec(`
    UPDATE media_jobs SET status = 'paused', updated_at = datetime('now')
    WHERE status = 'running'
  `);
  db.exec(`
    UPDATE media_job_items SET status = 'pending', updated_at = datetime('now')
    WHERE status = 'processing'
  `);

  // Create session_runtime_locks table
  db.exec(ENSURE_RUNTIME_LOCKS_TABLE_SQL);

  // Create permission_requests table
  db.exec(ENSURE_PERMISSION_REQUESTS_TABLE_SQL);

  expirePermissionRequestsInDatabase(db);
  db.exec(`
    UPDATE chat_sessions
    SET runtime_status = 'idle',
        runtime_error = 'Process restarted while session was running',
        runtime_updated_at = datetime('now')
    WHERE runtime_status = 'running'
  `);
  db.exec(`
    UPDATE chat_sessions
    SET runtime_status = 'idle',
        runtime_error = 'Process restarted while waiting for permission',
        runtime_updated_at = datetime('now')
    WHERE runtime_status = 'waiting_permission'
      AND id NOT IN (
        SELECT session_id
        FROM permission_requests
        WHERE status = 'pending'
      )
  `);
  db.exec("DELETE FROM session_runtime_locks");

  // Migrate existing settings to a default provider if api_providers is empty
  const providerCount = db.prepare('SELECT COUNT(*) as count FROM api_providers').get() as { count: number };
  if (providerCount.count === 0) {
    const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_auth_token'").get() as { value: string } | undefined;
    const baseUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_base_url'").get() as { value: string } | undefined;
    if (tokenRow || baseUrlRow) {
      const id = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      db.prepare(
        'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'Default', 'anthropic', baseUrlRow?.value || '', tokenRow?.value || '', 1, 0, '{}', 'Migrated from settings', now, now);
    }
  }

  db.exec(ENSURE_SESSION_CHANGE_LOG_SQL);

}

function dedupeMessagesByClientMessageId(db: Database.Database): void {
  type DuplicateMessageRow = {
    id: string;
    rowid: number;
    content: string;
    status: string | null;
    persisted_revision: number | null;
    content_format_version: number | null;
    completed_at: string | null;
    token_usage: string | null;
    created_at: string;
  };
  type MessagePartRow = {
    id: number;
    part_type: string;
    content: string;
    metadata: string | null;
    created_at: number;
    part_key: string | null;
    part_index: number | null;
    revision: number | null;
    is_final: number | null;
    updated_at: number | null;
  };
  const duplicates = db.prepare(`
    SELECT session_id, role, client_message_id, COUNT(*) AS cnt
    FROM messages
    WHERE client_message_id IS NOT NULL
    GROUP BY session_id, role, client_message_id
    HAVING cnt > 1
  `).all() as Array<{
    session_id: string;
    role: string;
    client_message_id: string;
    cnt: number;
  }>;

  if (duplicates.length === 0) {
    return;
  }

  const selectRows = db.prepare(`
    SELECT
      id,
      rowid,
      content,
      status,
      persisted_revision,
      content_format_version,
      completed_at,
      token_usage,
      created_at
    FROM messages
    WHERE session_id = ? AND role = ? AND client_message_id = ?
    ORDER BY rowid ASC
  `);
  const selectParts = db.prepare(`
    SELECT
      id,
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
    ORDER BY created_at ASC, id ASC
  `);
  const selectKeepPartByKey = db.prepare(`
    SELECT
      id,
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
    WHERE message_id = ? AND part_key = ?
    LIMIT 1
  `);
  const movePart = db.prepare('UPDATE message_parts SET message_id = ? WHERE id = ?');
  const deletePart = db.prepare('DELETE FROM message_parts WHERE id = ?');
  const updateKeepPart = db.prepare(`
    UPDATE message_parts
    SET part_type = ?,
        content = ?,
        metadata = ?,
        created_at = ?,
        part_index = ?,
        revision = ?,
        is_final = ?,
        updated_at = ?
    WHERE id = ?
  `);
  const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?');

  const messageScore = (row: DuplicateMessageRow) => ([
    row.status === 'completed' ? 3 : row.status === 'error' ? 2 : row.status === 'stopped' ? 1 : 0,
    row.content.trim().length > 0 ? 1 : 0,
    row.persisted_revision ?? -1,
    row.content_format_version ?? -1,
    row.completed_at ? 1 : 0,
    row.content.length,
    row.rowid,
  ] as const);

  const partScore = (row: MessagePartRow) => ([
    row.revision ?? -1,
    row.is_final ?? -1,
    row.updated_at ?? -1,
    row.created_at,
    row.id,
  ] as const);

  const compareScore = (left: readonly number[], right: readonly number[]) => {
    for (let index = 0; index < left.length; index += 1) {
      const delta = (left[index] ?? 0) - (right[index] ?? 0);
      if (delta !== 0) {
        return delta;
      }
    }
    return 0;
  };

  const deleteDuplicateGroups = db.transaction((entries: typeof duplicates) => {
    for (const duplicate of entries) {
      const rows = selectRows.all(
        duplicate.session_id,
        duplicate.role,
        duplicate.client_message_id,
      ) as DuplicateMessageRow[];

      if (rows.length <= 1) {
        continue;
      }

      const sortedRows = [...rows].sort((left, right) => compareScore(messageScore(right), messageScore(left)));
      const keepRow = sortedRows[0];
      const keepId = keepRow?.id;
      const removedRows = rows.filter((row) => row.id !== keepId);

      for (const row of removedRows) {
        const parts = selectParts.all(row.id) as MessagePartRow[];
        for (const part of parts) {
          if (!part.part_key) {
            movePart.run(keepId, part.id);
            continue;
          }

          const existingKeepPart = selectKeepPartByKey.get(keepId, part.part_key) as MessagePartRow | undefined;
          if (!existingKeepPart) {
            movePart.run(keepId, part.id);
            continue;
          }

          if (compareScore(partScore(part), partScore(existingKeepPart)) > 0) {
            updateKeepPart.run(
              part.part_type,
              part.content,
              part.metadata,
              part.created_at,
              part.part_index,
              part.revision,
              part.is_final,
              part.updated_at,
              existingKeepPart.id,
            );
          }
          deletePart.run(part.id);
        }

        deleteMessage.run(row.id);
      }

      console.warn(
        '[migration] deduped duplicate client_message_id rows',
        {
          session_id: duplicate.session_id,
          role: duplicate.role,
          client_message_id: duplicate.client_message_id,
          kept_id: keepId,
          removed_ids: removedRows.map((row) => row.id),
        },
      );
    }
  });

  deleteDuplicateGroups(duplicates);
}
