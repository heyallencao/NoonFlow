import { NextRequest } from 'next/server';
import {
  forceReleaseSessionLocks,
  getSessionLock,
  getSession,
  upsertSessionRuntimeState,
} from '@/lib/db';
import { stopActiveChatRun } from '@/lib/active-chat-run-registry';
import { sessionStateManager } from '@/lib/session-state-manager';
import { parseDBDate } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_LOCK_STALE_AFTER_MS = 150_000;

function isSessionLockStale(sessionId: string): boolean {
  const lock = getSessionLock(sessionId);
  if (!lock) {
    return false;
  }

  const nowMs = Date.now();
  const expiresAtMs = parseDBDate(lock.expires_at).getTime();
  if (!Number.isNaN(expiresAtMs) && expiresAtMs <= nowMs) {
    return true;
  }

  const updatedAtMs = parseDBDate(lock.updated_at).getTime();
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return (nowMs - updatedAtMs) >= SESSION_LOCK_STALE_AFTER_MS;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { session_id?: string };
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    if (!sessionId) {
      return Response.json({ error: 'session_id is required' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const isRunningLikeStatus = session.runtime_status === 'running'
      || session.runtime_status === 'waiting_permission';
    const hadActiveRun = stopActiveChatRun(sessionId);
    const hasStaleLock = !hadActiveRun && isSessionLockStale(sessionId);

    // Only request a cross-worker stop while the lock still looks live.
    const shouldRequestCrossWorkerStop = !hadActiveRun && isRunningLikeStatus && !hasStaleLock;
    const shouldForceReleaseLock = !hadActiveRun && (hasStaleLock || !isRunningLikeStatus);
    const releasedLocks = shouldForceReleaseLock ? forceReleaseSessionLocks(sessionId) : 0;

    sessionStateManager.updateSessionState(sessionId, {
      runtimeStatus: shouldRequestCrossWorkerStop ? 'stopping' : 'idle',
      runtimeError: '',
    });
    upsertSessionRuntimeState(sessionId, {
      status: shouldRequestCrossWorkerStop ? 'stopping' : 'idle',
      pendingPermissions: [],
      generationQueue: [],
    });

    return Response.json({
      stopped: hadActiveRun || shouldRequestCrossWorkerStop || releasedLocks > 0,
      hadActiveRun,
      requestedCrossWorkerStop: shouldRequestCrossWorkerStop,
      releasedLocks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop session';
    return Response.json({ error: message }, { status: 500 });
  }
}
