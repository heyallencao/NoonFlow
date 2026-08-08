import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { isPathSafe, isRootPath } from '@/lib/files';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RevertOperation {
  toolName: string;
  toolInput: unknown;
}

interface FileChange {
  filePath: string;
  toolName?: string;
  toolInput?: unknown;
  operations?: RevertOperation[];
}

interface RevertRequest {
  changes: FileChange[];
  baseDir?: string;
}

function resolveAndValidatePath(filePath: string, baseDir?: string | null) {
  const resolvedBase = baseDir ? path.resolve(baseDir) : null;
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolvedBase || process.cwd(), filePath);
  const homeDir = os.homedir();

  if (resolvedBase) {
    if (isRootPath(resolvedBase)) {
      return {
        error: 'Cannot use filesystem root as base directory',
      };
    }
    if (!isPathSafe(resolvedBase, resolvedPath)) {
      return {
        error: 'File is outside the project scope',
      };
    }
  } else if (!isPathSafe(homeDir, resolvedPath)) {
    return {
      error: 'File is outside the allowed scope',
    };
  }

  return { resolvedPath };
}

async function revertEditOperation(
  absolutePath: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const oldString = String(input.old_string || '');
  const newString = String(input.new_string || '');
  const replaceAll = Boolean(input.replace_all);

  console.log('[Revert API] Edit operation:', {
    oldStringLength: oldString.length,
    newStringLength: newString.length,
    replaceAll,
  });

  let currentContent: string;
  try {
    currentContent = await fs.readFile(absolutePath, 'utf-8');
    console.log('[Revert API] File read successfully, length:', currentContent.length);
  } catch (error) {
    console.error('[Revert API] Failed to read file:', error);
    return {
      success: false,
      error: `File not found: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  if (newString === '') {
    return {
      success: false,
      error: 'Cannot safely revert edits with an empty replacement string',
    };
  }

  if (!currentContent.includes(newString)) {
    return {
      success: false,
      error: 'Current file content no longer matches the recorded edit',
    };
  }

  const revertedContent = replaceAll
    ? currentContent.split(newString).join(oldString)
    : currentContent.replace(newString, oldString);

  console.log('[Revert API] Content replaced, writing back...');
  await fs.writeFile(absolutePath, revertedContent, 'utf-8');
  console.log('[Revert API] File written successfully');

  return { success: true };
}

async function revertWriteOperation(
  absolutePath: string,
): Promise<{ success: boolean; error?: string }> {
  console.log('[Revert API] Write operation - deleting file');
  try {
    await fs.unlink(absolutePath);
    console.log('[Revert API] File deleted successfully');
    return { success: true };
  } catch (error) {
    console.error('[Revert API] Failed to delete file:', error);
    return {
      success: false,
      error: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function normalizeOperations(change: FileChange): RevertOperation[] {
  if (Array.isArray(change.operations) && change.operations.length > 0) {
    return change.operations;
  }

  if (change.toolName) {
    return [{
      toolName: change.toolName,
      toolInput: change.toolInput,
    }];
  }

  return [];
}

/**
 * POST /api/revert-changes
 * Reverts file changes made by Write/Edit tools
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RevertRequest;
    const { changes, baseDir } = body;

    console.log('[Revert API] Received request:', {
      changesCount: changes?.length,
      baseDir,
      changes: changes?.map(c => ({
        filePath: c.filePath,
        operationCount: normalizeOperations(c).length,
      })),
    });

    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json(
        { error: 'No changes provided' },
        { status: 400 }
      );
    }

    const workingDir = baseDir || process.cwd();
    console.log('[Revert API] Working directory:', workingDir);

    const results: Array<{ filePath: string; success: boolean; error?: string }> = [];

    for (const change of changes) {
      try {
        const operations = normalizeOperations(change);

        console.log('[Revert API] Processing:', {
          filePath: change.filePath,
          operations: operations.map(operation => operation.toolName),
        });

        if (operations.length === 0) {
          results.push({
            filePath: change.filePath,
            success: false,
            error: 'No revert operations provided',
          });
          continue;
        }

        const validated = resolveAndValidatePath(change.filePath, workingDir);
        if ('error' in validated) {
          results.push({
            filePath: change.filePath,
            success: false,
            error: validated.error,
          });
          continue;
        }

        const absolutePath = validated.resolvedPath;
        console.log('[Revert API] Resolved path:', absolutePath);

        let errorMessage: string | undefined;
        for (const operation of [...operations].reverse()) {
          const toolName = operation.toolName.toLowerCase();
          const input = (operation.toolInput || {}) as Record<string, unknown>;

          if (toolName === 'edit') {
            const result = await revertEditOperation(absolutePath, input);
            if (!result.success) {
              errorMessage = result.error;
              break;
            }
            continue;
          }

          if (toolName === 'write') {
            const result = await revertWriteOperation(absolutePath);
            if (!result.success) {
              errorMessage = result.error;
              break;
            }
            continue;
          }

          console.warn('[Revert API] Unsupported tool type:', operation.toolName);
          errorMessage = `Unsupported tool type: ${operation.toolName}`;
          break;
        }

        if (errorMessage) {
          results.push({
            filePath: change.filePath,
            success: false,
            error: errorMessage,
          });
        } else {
          results.push({
            filePath: change.filePath,
            success: true,
          });
        }
      } catch (error) {
        console.error('[Revert API] Error processing change:', error);
        results.push({
          filePath: change.filePath,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    console.log('[Revert API] Results:', { successCount, failureCount, results });

    if (failureCount > 0) {
      return NextResponse.json(
        {
          message: `Reverted ${successCount} files, ${failureCount} failed`,
          results,
        },
        { status: 207 }
      );
    }

    return NextResponse.json({
      message: `Successfully reverted ${successCount} files`,
      results,
    });
  } catch (error) {
    console.error('[Revert API] Fatal error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to revert changes' },
      { status: 500 }
    );
  }
}
