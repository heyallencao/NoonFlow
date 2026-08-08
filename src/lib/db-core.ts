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

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    ensureDatabaseDirectory(DB_PATH);
    migrateLegacyDatabaseIfNeeded(DB_PATH);

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeDbSchema(db);
  }
  return db;
}

/**
 * Close the database connection gracefully.
 * In WAL mode, this ensures the WAL is checkpointed and the
 * -wal/-shm files are cleaned up properly.
 */
export function closeDb(): void {
  if (db) {
    try {
      db.close();
      console.log('[db] Database closed gracefully');
    } catch (err) {
      console.warn('[db] Error closing database:', err);
    }
    db = null;
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
