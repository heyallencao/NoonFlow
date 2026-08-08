import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import { readFilePreview, isPathSafe, isRootPath } from '@/lib/files';
import type { FilePreviewResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filePath = searchParams.get('path');
  const maxLines = parseInt(searchParams.get('maxLines') || '200', 10);

  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter' },
      { status: 400 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();

  // Validate that the file is within the session's working directory.
  // baseDir may be on a different drive than homeDir on Windows.
  // Only reject root paths as baseDir to prevent full-disk access.
  const baseDir = searchParams.get('baseDir');
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    if (isRootPath(resolvedBase)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Cannot use filesystem root as base directory' },
        { status: 403 }
      );
    }
    if (!isPathSafe(resolvedBase, resolvedPath)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'File is outside the project scope' },
        { status: 403 }
      );
    }
  } else {
    // Fallback: without a baseDir, restrict to the user's home directory
    // to prevent reading arbitrary system files like /etc/passwd
    if (!isPathSafe(homeDir, resolvedPath)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'File is outside the allowed scope' },
        { status: 403 }
      );
    }
  }

  try {
    const preview = await readFilePreview(resolvedPath, Math.min(maxLines, 1000));
    return NextResponse.json<FilePreviewResponse>({ preview });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to read file' },
      { status: 500 }
    );
  }
}
