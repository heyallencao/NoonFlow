import type Database from 'better-sqlite3';

export function expirePermissionRequestsInDatabase(
  database: Database.Database,
  now?: string,
): number {
  const cutoff = now || new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = database.prepare(
    `UPDATE permission_requests
     SET status = 'timeout', resolved_at = ?, message = 'Expired'
     WHERE status = 'pending' AND expires_at < ?`
  ).run(cutoff, cutoff);
  return result.changes;
}
