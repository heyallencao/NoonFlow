import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import { scanDirectory, scanDirectoryFlat, isPathSafe, isRootPath } from '@/lib/files';
import type { FileTreeResponse, ErrorResponse } from '@/types';

const DEFAULT_SCAN_DEPTH = 6;
const MAX_SCAN_DEPTH = 12;
const DEFAULT_FLAT_LIMIT = 20;
const MAX_FLAT_LIMIT = 100;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dir = searchParams.get('dir');
  const requestedDepth = parseInt(searchParams.get('depth') || String(DEFAULT_SCAN_DEPTH), 10);
  const depth = Number.isFinite(requestedDepth)
    ? Math.max(1, Math.min(requestedDepth, MAX_SCAN_DEPTH))
    : DEFAULT_SCAN_DEPTH;

  if (!dir) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing dir parameter' },
      { status: 400 }
    );
  }

  const resolvedDir = path.resolve(dir);
  const homeDir = os.homedir();

  // Use baseDir (the session's working directory) as the trust boundary.
  // baseDir is the project root the user explicitly chose — it may be on
  // a different drive than the home directory on Windows (e.g., D:\projects).
  // We only reject root paths (/, C:\) as baseDir to prevent full-disk scans.
  // If no baseDir is provided, fall back to the user's home directory.
  const baseDir = searchParams.get('baseDir');
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    // Prevent using a filesystem root as baseDir (e.g., /, C:\)
    if (isRootPath(resolvedBase)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Cannot use filesystem root as base directory' },
        { status: 403 }
      );
    }
    if (!isPathSafe(resolvedBase, resolvedDir)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Directory is outside the project scope' },
        { status: 403 }
      );
    }
  } else {
    // Fallback: without a baseDir, restrict to the user's home directory
    // to prevent scanning arbitrary system directories like /etc
    if (!isPathSafe(homeDir, resolvedDir)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Directory is outside the allowed scope' },
        { status: 403 }
      );
    }
  }

  try {
    const flatMode = searchParams.get('flat') === '1';
    if (flatMode) {
      const requestedLimit = parseInt(searchParams.get('limit') || String(DEFAULT_FLAT_LIMIT), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, MAX_FLAT_LIMIT))
        : DEFAULT_FLAT_LIMIT;
      const requestedOffset = parseInt(searchParams.get('offset') || '0', 10);
      const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;
      const filter = searchParams.get('filter') || '';

      const result = await scanDirectoryFlat(resolvedDir, depth, { filter, offset, limit });
      return NextResponse.json({
        items: result.items,
        root: resolvedDir,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
      });
    }

    const tree = await scanDirectory(resolvedDir, depth);
    return NextResponse.json<FileTreeResponse>({ tree, root: resolvedDir });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to scan directory' },
      { status: 500 }
    );
  }
}
