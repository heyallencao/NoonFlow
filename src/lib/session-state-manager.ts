import type { PermissionRequestEvent } from '@/types';
import {
  expirePermissionRequests,
  getLatestPendingPermissionRequestForSession,
  recoverDanglingStreamingAssistantMessages,
  getSession,
  upsertSessionRuntimeState,
  updateSessionStateRecord,
} from './db';
import { getConversation } from './conversation-registry';
import { hasPendingPermission } from './permission-registry';

export interface SessionState {
  sdkSessionId: string;
  sdkCwd: string;
  runtimeStatus: string;
  runtimeError: string;
  workingDirectory?: string;
}

export interface RecoveredSessionState {
  sessionId: string;
  sdkSessionId: string;
  sdkCwd: string;
  runtimeStatus: string;
  runtimeError: string;
  pendingPermission: PermissionRequestEvent | null;
  requiresRestart: boolean;
  hasLiveConversation: boolean;
  hasLivePermissionWaiter: boolean;
}

function toPendingPermissionEvent(record: NonNullable<ReturnType<typeof getLatestPendingPermissionRequestForSession>>): PermissionRequestEvent {
  let toolInput: Record<string, unknown> = {};
  try {
    toolInput = JSON.parse(record.tool_input) as Record<string, unknown>;
  } catch {
    toolInput = {};
  }

  return {
    permissionRequestId: record.id,
    toolName: record.tool_name,
    toolInput,
    decisionReason: record.decision_reason || undefined,
    toolUseId: '',
    description: record.message || undefined,
  };
}

const INTERRUPTED_RUNTIME_ERROR_PATTERNS: RegExp[] = [
  /stream disconnected before response\.completed/i,
  /stream disconnected/i,
  /request channel disconnected/i,
  /process restarted while session was running/i,
  /previous run was interrupted/i,
];

function isInterruptedRecoveryError(runtimeError: string): boolean {
  const normalized = runtimeError.trim();
  if (!normalized) {
    return false;
  }
  return INTERRUPTED_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class SessionStateManager {
  updateSessionState(sessionId: string, updates: Partial<SessionState>): void {
    updateSessionStateRecord(sessionId, {
      sdkSessionId: updates.sdkSessionId,
      sdkCwd: updates.sdkCwd,
      runtimeStatus: updates.runtimeStatus,
      runtimeError: updates.runtimeError,
      workingDirectory: updates.workingDirectory,
    });
  }

  recoverSession(sessionId: string): RecoveredSessionState | undefined {
    expirePermissionRequests();

    const session = getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const pendingPermissionRecord = getLatestPendingPermissionRequestForSession(sessionId);
    const hasLiveConversation = Boolean(getConversation(sessionId));
    const hasLivePermissionWaiter = pendingPermissionRecord ? hasPendingPermission(pendingPermissionRecord.id) : false;
    let runtimeStatus = session.runtime_status;
    let runtimeError = session.runtime_error || '';
    let requiresRestart = false;
    let recoveredDanglingStreamingCount = 0;

    if (!hasLiveConversation) {
      recoveredDanglingStreamingCount = recoverDanglingStreamingAssistantMessages(sessionId);
    }

    if (runtimeStatus === 'running' && !hasLiveConversation) {
      runtimeStatus = 'idle';
      runtimeError = runtimeError || 'Previous run was interrupted. Continue by sending a follow-up message.';
      this.updateSessionState(sessionId, {
        runtimeStatus,
        runtimeError,
      });
      upsertSessionRuntimeState(sessionId, {
        status: 'idle',
        pendingPermissions: [],
        generationQueue: [],
      });
    }

    if (runtimeStatus === 'waiting_permission') {
      if (pendingPermissionRecord) {
        if (!hasLivePermissionWaiter) {
          requiresRestart = true;
          runtimeError = runtimeError || 'Permission request recovered from the database. Resolving it will require restarting the interrupted run.';
          this.updateSessionState(sessionId, {
            runtimeStatus,
            runtimeError,
          });
        }
      } else {
        runtimeStatus = 'idle';
        runtimeError = runtimeError || 'Pending permission expired or was lost. Retry the action to continue.';
        this.updateSessionState(sessionId, {
          runtimeStatus,
          runtimeError,
        });
        upsertSessionRuntimeState(sessionId, {
          status: 'idle',
          pendingPermissions: [],
          generationQueue: [],
        });
      }
    }

    if (runtimeStatus === 'stopping' && !hasLiveConversation) {
      runtimeStatus = 'idle';
      runtimeError = runtimeError || 'Previous stop request was recovered after the run ended. You can continue with a new message.';
      this.updateSessionState(sessionId, {
        runtimeStatus,
        runtimeError,
      });
      upsertSessionRuntimeState(sessionId, {
        status: 'idle',
        pendingPermissions: [],
        generationQueue: [],
      });
    }

    if (runtimeStatus === 'error' && !hasLiveConversation) {
      const shouldClearInterruptedError = recoveredDanglingStreamingCount > 0
        || isInterruptedRecoveryError(runtimeError);
      if (shouldClearInterruptedError) {
        runtimeStatus = 'idle';
        runtimeError = '';
        this.updateSessionState(sessionId, {
          runtimeStatus,
          runtimeError,
        });
        upsertSessionRuntimeState(sessionId, {
          status: 'idle',
          pendingPermissions: [],
          generationQueue: [],
        });
      }
    }

    const refreshedSession = getSession(sessionId);
    if (!refreshedSession) {
      return undefined;
    }

    return {
      sessionId,
      sdkSessionId: refreshedSession.sdk_session_id,
      sdkCwd: refreshedSession.sdk_cwd,
      runtimeStatus: refreshedSession.runtime_status,
      runtimeError: refreshedSession.runtime_error,
      pendingPermission: pendingPermissionRecord ? toPendingPermissionEvent(pendingPermissionRecord) : null,
      requiresRestart,
      hasLiveConversation,
      hasLivePermissionWaiter,
    };
  }

  markRecoveredPermissionResolved(sessionId: string, behavior: 'allow' | 'deny'): void {
    this.updateSessionState(sessionId, {
      runtimeStatus: 'idle',
      runtimeError: behavior === 'allow'
        ? 'Permission decision recorded after recovery. Re-run the task to continue.'
        : 'Permission denied after recovery.',
    });
    upsertSessionRuntimeState(sessionId, {
      status: 'idle',
      pendingPermissions: [],
      generationQueue: [],
    });
  }
}

export const sessionStateManager = new SessionStateManager();
