import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.noonflow');
const LEGACY_DEFAULT_DATA_DIR = path.join(os.homedir(), '.monolith');
const dataDir = process.env.CLAUDE_GUI_DATA_DIR || DEFAULT_DATA_DIR;

export const DB_PATH = path.join(dataDir, 'noonflow.db');

function looksLikeDefaultAppDataDir(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const home = os.homedir();
  const allowed = new Set([
    path.resolve(DEFAULT_DATA_DIR),
    path.resolve(path.join(home, 'Library', 'Application Support', 'NoonFlow')),
    path.resolve(path.join(home, 'Library', 'Application Support', 'noonflow')),
    path.resolve(path.join(home, 'AppData', 'Roaming', 'NoonFlow')),
    path.resolve(path.join(home, 'AppData', 'Roaming', 'noonflow')),
    path.resolve(path.join(home, '.config', 'NoonFlow')),
    path.resolve(path.join(home, '.config', 'noonflow')),
  ]);

  return allowed.has(resolved);
}

function getLegacyDbPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(LEGACY_DEFAULT_DATA_DIR, 'noonflow.db'),
    path.join(LEGACY_DEFAULT_DATA_DIR, 'monolith.db'),
    // Legacy desktop-shell userData paths from pre-migration builds
    path.join(home, 'Library', 'Application Support', 'NoonFlow', 'monolith.db'),
    path.join(home, 'Library', 'Application Support', 'noonflow', 'monolith.db'),
    path.join(home, 'Library', 'Application Support', 'Monolith', 'monolith.db'),
    path.join(home, 'Library', 'Application Support', 'monolith', 'monolith.db'),
    path.join(home, 'Library', 'Application Support', 'Claude GUI', 'monolith.db'),
    // Old dev-mode fallback
    path.join(process.cwd(), 'data', 'monolith.db'),
    // Legacy name
    path.join(home, 'Library', 'Application Support', 'Monolith', 'claude-gui.db'),
    path.join(home, 'Library', 'Application Support', 'monolith', 'claude-gui.db'),
  ];
}

export function ensureDatabaseDirectory(dbPath: string = DB_PATH): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function migrateLegacyDatabaseIfNeeded(dbPath: string = DB_PATH): void {
  if (fs.existsSync(dbPath)) {
    return;
  }

  if (process.env.CLAUDE_GUI_DATA_DIR && !looksLikeDefaultAppDataDir(process.env.CLAUDE_GUI_DATA_DIR)) {
    return;
  }

  for (const oldPath of getLegacyDbPaths()) {
    if (!fs.existsSync(oldPath)) {
      continue;
    }

    try {
      ensureDatabaseDirectory(dbPath);
      fs.copyFileSync(oldPath, dbPath);
      // Also copy WAL/SHM if they exist
      if (fs.existsSync(oldPath + '-wal')) {
        fs.copyFileSync(oldPath + '-wal', dbPath + '-wal');
      }
      if (fs.existsSync(oldPath + '-shm')) {
        fs.copyFileSync(oldPath + '-shm', dbPath + '-shm');
      }
      console.log(`[db] Migrated database from ${oldPath}`);
      break;
    } catch (err) {
      console.warn(`[db] Failed to migrate from ${oldPath}:`, err);
    }
  }
}
