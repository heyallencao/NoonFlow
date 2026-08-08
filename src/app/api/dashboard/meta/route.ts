import os from 'os';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const homeDir = os.homedir();
  const username = path.basename(homeDir);

  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  let hooksCount = 0;
  let permissionsCount = 0;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, unknown>;
      allowedTools?: unknown[];
    };
    hooksCount = Object.keys(settings.hooks || {}).length;
    permissionsCount = (settings.allowedTools || []).length;
  } catch {
    // settings file may not exist
  }

  return Response.json({ username, hooksCount, permissionsCount });
}
