async function main() {
  const { getDb, closeDb } = await import('../src/lib/db');

  const db = getDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('message_parts', 'session_runtime_state') ORDER BY name"
  ).all() as Array<{ name: string }>;

  console.log('[db:migrate] verified tables:', tables.map((table) => table.name).join(', ') || 'none');
  closeDb();
}

void main();
