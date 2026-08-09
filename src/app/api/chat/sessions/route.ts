import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createSession, getAllSessions, getSetting } from '@/lib/db';
import { listNativeSessions } from '@/lib/native-session-catalog';
import {
  getAssistantRuntimeStatus,
  getDefaultAssistantRuntime,
  getPreferredAvailableAssistantRuntime,
} from '@/lib/assistant-runtimes';
import { SETTING_KEYS, type CreateSessionRequest, type SessionListType, type SessionsResponse, type SessionResponse } from '@/types';

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
    parseCursorParam(request.nextUrl.searchParams.get('cursor'));
    const workspaces = request.nextUrl.searchParams.getAll('workspace').filter(Boolean);
    const openedOnly = request.nextUrl.searchParams.get('openedOnly') === '1';
    const sessionType: SessionListType = type === 'terminal' || type === 'all' ? type : 'chat';
    const nativeSessions = openedOnly && workspaces.length === 0
      ? []
      : listNativeSessions(sessionType, workspaces.length > 0 ? workspaces : undefined);
    const workspaceSet = new Set(workspaces);
    const transientSessions = getAllSessions(sessionType).filter(
      (session) => !openedOnly || workspaceSet.has(session.working_directory || ''),
    );
    const transientIds = new Set(transientSessions.map((session) => session.id));
    const claimedNativeIds = new Set(
      transientSessions.map((session) => session.sdk_session_id).filter(Boolean),
    );
    const unclaimedNativeSessions = nativeSessions.filter(
      (session) => !transientIds.has(session.id) && !claimedNativeIds.has(session.id),
    );
    const sessions = [...transientSessions, ...unclaimedNativeSessions]
      .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
    const response: SessionsResponse = {
      sessions,
      deleted_session_ids: [],
      next_cursor: 0,
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
      const explicitlyLaunchablePi = isExplicitSelection
        && runtimeStatus?.id === 'pi'
        && runtimeStatus.launchable;

      if (!runtimeStatus || (!runtimeStatus.available && !explicitlyLaunchablePi)) {
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

    const finalModel = resolvedRuntime === 'claude_code'
      ? body.model
      : resolvedRuntime === 'pi'
      ? body.model || getSetting(SETTING_KEYS.PI_DEFAULT_MODEL)
      : undefined;
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
