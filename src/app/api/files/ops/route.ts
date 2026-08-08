import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isPathSafe, isRootPath } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BasePayload {
  baseDir?: unknown;
}

interface CreatePayload extends BasePayload {
  parentPath?: unknown;
  name?: unknown;
  nodeType?: unknown;
  content?: unknown;
}

interface RenamePayload extends BasePayload {
  targetPath?: unknown;
  newName?: unknown;
}

interface DeletePayload extends BasePayload {
  targetPath?: unknown;
}

function parseNodeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name) return null;
  if (name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\')) return null;
  return name;
}

function parseBaseDir(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const baseDir = path.resolve(value);
  if (isRootPath(baseDir)) return null;
  return baseDir;
}

function validatePathInScope(baseDir: string, targetPath: string): string | null {
  const resolvedTarget = path.resolve(targetPath);
  return isPathSafe(baseDir, resolvedTarget) ? resolvedTarget : null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CreatePayload | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const baseDir = parseBaseDir(body.baseDir);
  if (!baseDir) {
    return NextResponse.json({ error: 'Valid baseDir is required' }, { status: 400 });
  }

  if (body.nodeType !== 'file' && body.nodeType !== 'directory') {
    return NextResponse.json({ error: 'nodeType must be "file" or "directory"' }, { status: 400 });
  }

  const parentPath = typeof body.parentPath === 'string' ? body.parentPath : '';
  const resolvedParent = validatePathInScope(baseDir, parentPath);
  if (!resolvedParent) {
    return NextResponse.json({ error: 'Parent path is outside the project scope' }, { status: 403 });
  }

  const name = parseNodeName(body.name);
  if (!name) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }

  let parentStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    parentStat = await fs.stat(resolvedParent);
  } catch {
    return NextResponse.json({ error: 'Parent path does not exist' }, { status: 404 });
  }
  if (!parentStat.isDirectory()) {
    return NextResponse.json({ error: 'Parent path must be a directory' }, { status: 400 });
  }

  const targetPath = validatePathInScope(baseDir, path.join(resolvedParent, name));
  if (!targetPath) {
    return NextResponse.json({ error: 'Target path is outside the project scope' }, { status: 403 });
  }

  if (await pathExists(targetPath)) {
    return NextResponse.json({ error: 'Target already exists' }, { status: 409 });
  }

  try {
    if (body.nodeType === 'directory') {
      await fs.mkdir(targetPath);
    } else {
      const content = typeof body.content === 'string' ? body.content : '';
      await fs.writeFile(targetPath, content, 'utf-8');
    }
    return NextResponse.json({ success: true, path: targetPath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create node' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RenamePayload | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const baseDir = parseBaseDir(body.baseDir);
  if (!baseDir) {
    return NextResponse.json({ error: 'Valid baseDir is required' }, { status: 400 });
  }

  const targetPath = typeof body.targetPath === 'string' ? body.targetPath : '';
  const resolvedTarget = validatePathInScope(baseDir, targetPath);
  if (!resolvedTarget) {
    return NextResponse.json({ error: 'Target path is outside the project scope' }, { status: 403 });
  }
  if (resolvedTarget === baseDir) {
    return NextResponse.json({ error: 'Project root cannot be renamed' }, { status: 400 });
  }

  const newName = parseNodeName(body.newName);
  if (!newName) {
    return NextResponse.json({ error: 'Invalid newName' }, { status: 400 });
  }

  const nextPath = validatePathInScope(baseDir, path.join(path.dirname(resolvedTarget), newName));
  if (!nextPath) {
    return NextResponse.json({ error: 'Renamed path is outside the project scope' }, { status: 403 });
  }

  if (!(await pathExists(resolvedTarget))) {
    return NextResponse.json({ error: 'Target does not exist' }, { status: 404 });
  }
  if (await pathExists(nextPath)) {
    return NextResponse.json({ error: 'A file or folder with this name already exists' }, { status: 409 });
  }

  try {
    await fs.rename(resolvedTarget, nextPath);
    return NextResponse.json({ success: true, path: nextPath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename node' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as DeletePayload | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const baseDir = parseBaseDir(body.baseDir);
  if (!baseDir) {
    return NextResponse.json({ error: 'Valid baseDir is required' }, { status: 400 });
  }

  const targetPath = typeof body.targetPath === 'string' ? body.targetPath : '';
  const resolvedTarget = validatePathInScope(baseDir, targetPath);
  if (!resolvedTarget) {
    return NextResponse.json({ error: 'Target path is outside the project scope' }, { status: 403 });
  }
  if (resolvedTarget === baseDir) {
    return NextResponse.json({ error: 'Project root cannot be deleted' }, { status: 400 });
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(resolvedTarget);
  } catch {
    return NextResponse.json({ error: 'Target does not exist' }, { status: 404 });
  }

  try {
    if (stat.isDirectory()) {
      await fs.rm(resolvedTarget, { recursive: true, force: false });
    } else {
      await fs.unlink(resolvedTarget);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete node' },
      { status: 500 }
    );
  }
}
