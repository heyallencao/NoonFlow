import Database from 'better-sqlite3';

import { DB_PATH, ensureDatabaseDirectory, migrateLegacyDatabaseIfNeeded } from './db-core/paths';
import { initializeDbSchema } from './db-core/schema';

export type {
  MessagePartInput,
  MessagePartRecord,
  SessionRuntimeStatePatch,
  SessionRuntimeStateRecord,
  SessionRuntimeStatus,
} from './db-core/types';

const DATABASE_GLOBAL_KEY = '__noonflowEphemeralDatabase';

type NoonFlowDatabaseGlobal = typeof globalThis & {
  [DATABASE_GLOBAL_KEY]?: Database.Database;
};

function getDatabaseGlobal(): NoonFlowDatabaseGlobal {
  return globalThis as NoonFlowDatabaseGlobal;
}

const EPHEMERAL_SESSION_TABLES = [
  'chat_sessions',
  'messages',
  'tasks',
  'message_parts',
  'session_runtime_state',
  'permission_requests',
  'session_runtime_locks',
  'context_budget_events',
  'session_change_log',
] as const;

/**
 * NoonFlow treats Claude Code, Codex, and Pi as the sole owners of conversation
 * history. The legacy on-disk tables are kept empty for schema compatibility,
 * while the existing chat pipeline writes only to TEMP tables for the lifetime
 * of the local server process.
 */
function initializeEphemeralConversationStorage(database: Database.Database): void {
  database.transaction(() => {
    // Remove legacy NoonFlow-owned conversation copies without touching the
    // native ~/.claude, ~/.codex, or ~/.pi stores.
    database.exec(`
      DELETE FROM main.context_budget_events;
      DELETE FROM main.permission_requests;
      DELETE FROM main.session_runtime_state;
      DELETE FROM main.session_runtime_locks;
      DELETE FROM main.message_parts;
      DELETE FROM main.messages;
      DELETE FROM main.tasks;
      DELETE FROM main.chat_sessions;
      DELETE FROM main.session_change_log;
      DROP TABLE IF EXISTS main.channel_permission_links;
      DROP TABLE IF EXISTS main.channel_outbound_refs;
      DROP TABLE IF EXISTS main.channel_audit_logs;
      DROP TABLE IF EXISTS main.channel_dedupe;
      DROP TABLE IF EXISTS main.channel_offsets;
      DROP TABLE IF EXISTS main.channel_bindings;
      DROP TABLE IF EXISTS main.worktrees;
      DROP TABLE IF EXISTS main.widget_telemetry_events;
      DELETE FROM main.settings WHERE key IN (
        'telegram_bot_token',
        'telegram_chat_id',
        'telegram_enabled',
        'telegram_notify_start',
        'telegram_notify_complete',
        'telegram_notify_error',
        'telegram_notify_permission',
        'telegram_bridge_allowed_users',
        'remote_bridge_enabled',
        'bridge_telegram_enabled',
        'bridge_auto_start',
        'bridge_default_work_dir',
        'bridge_default_model',
        'bridge_default_provider_id'
      );
    `);

    for (const table of EPHEMERAL_SESSION_TABLES) {
      const tableRow = database.prepare(
        "SELECT sql FROM main.sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table) as { sql?: string } | undefined;
      if (!tableRow?.sql) {
        throw new Error(`Missing schema for ephemeral table: ${table}`);
      }
      database.exec(tableRow.sql.replace(/^CREATE TABLE/i, 'CREATE TEMP TABLE'));

      const indexes = database.prepare(
        "SELECT name, sql FROM main.sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      ).all(table) as Array<{ name: string; sql: string }>;
      for (const index of indexes) {
        const tempIndexName = `temp_${index.name}`;
        const indexSql = index.sql.replace(
          /^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+[^\s]+/i,
          (_match, unique: string | undefined) => `CREATE ${unique || ''}INDEX temp.${tempIndexName}`,
        );
        database.exec(indexSql);
      }

      const triggers = database.prepare(
        "SELECT name, sql FROM main.sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL",
      ).all(table) as Array<{ name: string; sql: string }>;
      for (const trigger of triggers) {
        const triggerSql = trigger.sql.replace(
          /^CREATE TRIGGER(?: IF NOT EXISTS)?\s+[^\s]+/i,
          `CREATE TEMP TRIGGER temp_${trigger.name}`,
        );
        database.exec(triggerSql);
      }
    }
  })();
}

export function getDb(): Database.Database {
  const databaseGlobal = getDatabaseGlobal();
  if (!databaseGlobal[DATABASE_GLOBAL_KEY]) {
    ensureDatabaseDirectory(DB_PATH);
    migrateLegacyDatabaseIfNeeded(DB_PATH);

    const database = new Database(DB_PATH);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('temp_store = MEMORY');
    initializeDbSchema(database);
    initializeEphemeralConversationStorage(database);
    databaseGlobal[DATABASE_GLOBAL_KEY] = database;
  }
  return databaseGlobal[DATABASE_GLOBAL_KEY];
}

/**
 * Close the database connection gracefully.
 * In WAL mode, this ensures the WAL is checkpointed and the
 * -wal/-shm files are cleaned up properly.
 */
export function closeDb(): void {
  const databaseGlobal = getDatabaseGlobal();
  const database = databaseGlobal[DATABASE_GLOBAL_KEY];
  if (database) {
    try {
      database.close();
      console.log('[db] Database closed gracefully');
    } catch (err) {
      console.warn('[db] Error closing database:', err);
    }
    delete databaseGlobal[DATABASE_GLOBAL_KEY];
  }
}

// Register shutdown handlers to close the database when the process exits.
// This prevents WAL file accumulation and potential data loss.
function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[db] Received ${signal}, closing database...`);
    closeDb();
  };

  // 'exit' fires synchronously when the process is about to exit
  process.on('exit', () => shutdown('exit'));

  // Handle termination signals (Docker stop, systemd, Ctrl+C, etc.)
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
    process.exit(0);
  });

  // Handle Windows-specific close events
  if (process.platform === 'win32') {
    process.on('SIGHUP', () => {
      shutdown('SIGHUP');
      process.exit(0);
    });
  }
}

registerShutdownHandlers();
