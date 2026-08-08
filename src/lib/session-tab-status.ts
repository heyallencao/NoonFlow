import type { SessionStreamSnapshot } from '@/types';

export type TabExecutionStatus = 'running' | 'waiting' | 'error' | 'ready' | 'unknown';

export interface SessionTabRuntimeState {
  status: string;
  error: string;
}

interface ResolveSessionTabExecutionStatusOptions {
  snapshot?: Pick<SessionStreamSnapshot, 'phase' | 'pendingPermission' | 'permissionResolved' | 'error'> | null;
  hasPendingApproval?: boolean;
  hasActiveStream?: boolean;
  runtime?: SessionTabRuntimeState | null;
}

function hasErrorText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveSessionTabExecutionStatus({
  snapshot,
  hasPendingApproval = false,
  hasActiveStream = false,
  runtime,
}: ResolveSessionTabExecutionStatusOptions): TabExecutionStatus {
  if (snapshot) {
    if (snapshot.pendingPermission && !snapshot.permissionResolved) {
      return hasErrorText(snapshot.error) ? 'error' : 'waiting';
    }
    if (snapshot.phase === 'active') {
      return 'running';
    }
    if (snapshot.phase === 'error') {
      return 'error';
    }
    if (snapshot.phase === 'completed' || snapshot.phase === 'stopped') {
      return 'ready';
    }
  }

  if (hasPendingApproval) {
    return 'waiting';
  }
  if (hasActiveStream) {
    return 'running';
  }
  if (!runtime) {
    return 'unknown';
  }
  if (runtime.status === 'running') {
    return 'running';
  }
  if (runtime.status === 'error') {
    return 'error';
  }
  if (hasErrorText(runtime.error)) {
    return 'error';
  }
  if (runtime.status === 'waiting_permission') {
    return 'waiting';
  }
  if (runtime.status === 'idle' || runtime.status === 'completed' || runtime.status === 'stopped') {
    return 'ready';
  }
  return 'unknown';
}
