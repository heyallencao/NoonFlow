import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DOC_PREVIEW_EDIT_MAX_BYTES } from '@/lib/doc-preview-mode';
import { isLikelyBinaryBuffer, isPathSafe, isRootPath } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.py': 'text/x-python',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.sql': 'text/x-sql',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.dart': 'text/x-dart',
  '.lua': 'text/x-lua',
  '.zig': 'text/x-zig',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.graphql': 'text/x-graphql',
  '.gql': 'text/x-graphql',
  '.prisma': 'text/x-prisma',
  '.dockerfile': 'text/x-dockerfile',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function buildContentDisposition(filename: string): string {
  const asciiFallbackRaw = filename
    .normalize('NFC')
    .replace(/["\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim();
  const asciiFallback = asciiFallbackRaw || 'file';
  const encoded = encodeURIComponent(filename.normalize('NFC'))
    .replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function resolveAndValidatePath(filePath: string, baseDir?: string | null) {
  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();

  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    if (isRootPath(resolvedBase)) {
      return {
        error: NextResponse.json(
          { error: 'Cannot use filesystem root as base directory' },
          { status: 403 }
        ),
      };
    }
    if (!isPathSafe(resolvedBase, resolvedPath)) {
      return {
        error: NextResponse.json(
          { error: 'File is outside the project scope' },
          { status: 403 }
        ),
      };
    }
  } else if (!isPathSafe(homeDir, resolvedPath)) {
    return {
      error: NextResponse.json(
        { error: 'File is outside the allowed scope' },
        { status: 403 }
      ),
    };
  }

  return { resolvedPath };
}

async function isBinaryFile(resolvedPath: string): Promise<boolean> {
  const handle = await fs.open(resolvedPath, 'r');

  try {
    const buffer = Buffer.alloc(8 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return isLikelyBinaryBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  const baseDir = request.nextUrl.searchParams.get('baseDir');
  const mode = request.nextUrl.searchParams.get('mode');
  const editMode = mode === 'edit';

  if (!filePath) {
    return NextResponse.json({ error: 'path parameter is required' }, { status: 400 });
  }

  const validated = resolveAndValidatePath(filePath, baseDir);
  if ('error' in validated) {
    return validated.error;
  }

  try {
    await fs.access(validated.resolvedPath);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = await fs.stat(validated.resolvedPath);
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Not a file' }, { status: 400 });
  }

  if (editMode) {
    if (stat.size > DOC_PREVIEW_EDIT_MAX_BYTES) {
      return NextResponse.json(
        {
          error: 'File is too large to edit here',
          code: 'FILE_TOO_LARGE',
          size: stat.size,
          maxSize: DOC_PREVIEW_EDIT_MAX_BYTES,
        },
        { status: 413 }
      );
    }

    if (await isBinaryFile(validated.resolvedPath)) {
      return NextResponse.json(
        {
          error: 'Binary files cannot be edited here',
          code: 'BINARY_FILE',
          size: stat.size,
        },
        { status: 415 }
      );
    }
  }

  const buffer = await fs.readFile(validated.resolvedPath);
  const ext = path.extname(validated.resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': buildContentDisposition(path.basename(validated.resolvedPath)),
      'X-File-Size': String(stat.size),
    },
  });
}

interface PutBody {
  path?: unknown;
  content?: unknown;
  baseDir?: unknown;
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'path and content are required' }, { status: 400 });
  }

  const baseDir = typeof body.baseDir === 'string' ? body.baseDir : null;
  const validated = resolveAndValidatePath(body.path, baseDir);
  if ('error' in validated) {
    return validated.error;
  }

  try {
    const stat = await fs.stat(validated.resolvedPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const contentSize = Buffer.byteLength(body.content, 'utf-8');
  if (contentSize > DOC_PREVIEW_EDIT_MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'Edited content is too large to save here',
        code: 'FILE_TOO_LARGE',
        size: contentSize,
        maxSize: DOC_PREVIEW_EDIT_MAX_BYTES,
      },
      { status: 413 }
    );
  }

  try {
    await fs.writeFile(validated.resolvedPath, body.content, 'utf-8');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save file' },
      { status: 500 }
    );
  }
}
