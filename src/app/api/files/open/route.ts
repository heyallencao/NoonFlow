import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { openPathExecutor } from '@/lib/open-path-executor';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const requestedPath = body?.path;
  if (!requestedPath || typeof requestedPath !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const resolvedPath = path.resolve(requestedPath);

  try {
    await fs.access(resolvedPath);
  } catch {
    return NextResponse.json({ error: 'Path does not exist' }, { status: 404 });
  }

  const platform = process.platform;
  let command: string;
  if (platform === 'darwin') {
    command = 'open';
  } else if (platform === 'win32') {
    command = 'explorer';
  } else {
    command = 'xdg-open';
  }

  return new Promise<NextResponse>((resolve) => {
    openPathExecutor.execFile(command, [resolvedPath], (err) => {
      if (err) {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
