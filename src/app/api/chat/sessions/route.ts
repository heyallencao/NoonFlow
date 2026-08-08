import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createSession, getSessionsByCursor } from '@/lib/db';
import {
  getAssistantRuntimeStatus,
  getDefaultAssistantRuntime,
  getPreferredAvailableAssistantRuntime,
} from '@/lib/assistant-runtimes';
import type { CreateSessionRequest, SessionListType, SessionsResponse, SessionResponse } from '@/types';

function parseCursorParam(rawCursor: string | null): number | undefined {
  if (rawCursor === null || rawCursor.trim() === '') {
    return undefined;
  }

  if (!/^\d+$/.test(rawCursor)) {
    throw new Error('INVALID_CURSOR');
  }

  const cursor = Number.parseInt(rawCursor, 10);
  if (!Number.isFinite(cursor) || cursor < 0) {
    throw new Error('INVALID_CURSOR');
  }

  return cursor;
}

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type');
    const cursor = parseCursorParam(request.nextUrl.searchParams.get('cursor'));
    const workspace = request.nextUrl.searchParams.get('workspace');
    const sessionType: SessionListType = type === 'terminal' || type === 'all' ? type : 'chat';
    const { sessions, deletedSessionIds, nextCursor } = getSessionsByCursor(
      sessionType,
      cursor,
      workspace || undefined
    );
    const response: SessionsResponse = {
      sessions,
      deleted_session_ids: deletedSessionIds,
      next_cursor: nextCursor,
    };
    return Response.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return Response.json(
        { error: 'Invalid cursor parameter', code: 'INVALID_CURSOR' },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json();
    const sessionType = body.session_type === 'terminal' ? 'terminal' : 'chat';

    // Validate working_directory is provided
    if (!body.working_directory) {
      return Response.json(
        { error: 'Working directory is required', code: 'MISSING_DIRECTORY' },
        { status: 400 },
      );
    }

    // Validate directory actually exists on disk
    try {
      await fs.access(body.working_directory);
    } catch {
      return Response.json(
        { error: 'Directory does not exist', code: 'INVALID_DIRECTORY' },
        { status: 400 },
      );
    }

    // P2 fix: Distinguish explicit runtime selection from default fallback
    const requestedRuntime = body.assistant_runtime;
    const isExplicitSelection = requestedRuntime !== undefined;
    const runtimeToUse = requestedRuntime ?? getDefaultAssistantRuntime();

    let resolvedRuntime = runtimeToUse;
    if (sessionType === 'chat') {
      const runtimeStatus = await getAssistantRuntimeStatus(runtimeToUse);

      if (!runtimeStatus || !runtimeStatus.available) {
        // If user explicitly selected this runtime, fail immediately
        if (isExplicitSelection) {
          return Response.json(
            {
              error: runtimeStatus?.status_message || `${runtimeToUse} is not available`,
              code: 'ASSISTANT_RUNTIME_UNAVAILABLE',
              assistant_runtime: runtimeToUse,
            },
            { status: 400 },
          );
        }

        // Only fallback if this was a default value (not explicit selection)
        const preferredRuntime = await getPreferredAvailableAssistantRuntime(runtimeToUse);
        if (!preferredRuntime) {
          return Response.json(
            {
              error: runtimeStatus?.status_message || `${runtimeToUse} is not available`,
              code: 'ASSISTANT_RUNTIME_UNAVAILABLE',
              assistant_runtime: runtimeToUse,
            },
            { status: 400 },
          );
        }
        resolvedRuntime = preferredRuntime;
      }
    }

    const finalModel = resolvedRuntime === 'claude_code' ? body.model : undefined;
    const finalProviderId = resolvedRuntime === 'claude_code' ? body.provider_id : undefined;

    if (resolvedRuntime !== runtimeToUse) {
      console.warn('[POST /api/chat/sessions] Runtime fallback occurred', {
        requested: runtimeToUse,
        resolved: resolvedRuntime,
        preserved_model: finalModel,
        preserved_provider: finalProviderId,
      });
    }

    const session = createSession(
      body.title,
      finalModel,
      body.system_prompt,
      body.working_directory,
      body.mode,
      finalProviderId,
      sessionType,
      body.worktree_id,
      resolvedRuntime,
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
