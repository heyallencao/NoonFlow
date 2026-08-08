import { useEffect } from 'react';
import type { PermissionRequestEvent } from '@/types';

interface UseChatStreamStatusSyncParams {
  sessionId: string;
  isStreaming: boolean;
  isStopping: boolean;
  pendingPermission: PermissionRequestEvent | null;
  permissionResolved: string | null;
  setStreamingSessionId: (sessionId: string) => void;
  setPendingApprovalSessionId: (sessionId: string) => void;
  updateSendLock: (locked: boolean) => void;
}

export function useChatStreamStatusSync(
  params: UseChatStreamStatusSyncParams,
): void {
  const {
    sessionId,
    isStreaming,
    isStopping,
    pendingPermission,
    permissionResolved,
    setStreamingSessionId,
    setPendingApprovalSessionId,
    updateSendLock,
  } = params;

  useEffect(() => {
    if (isStreaming) {
      setStreamingSessionId(sessionId);
      updateSendLock(true);
    } else {
      setStreamingSessionId('');
      if (!isStopping) {
        updateSendLock(false);
      }
    }

    if (pendingPermission && !permissionResolved) {
      setPendingApprovalSessionId(sessionId);
    } else if (!isStreaming) {
      setPendingApprovalSessionId('');
    }
  }, [
    isStopping,
    isStreaming,
    pendingPermission,
    permissionResolved,
    sessionId,
    setPendingApprovalSessionId,
    setStreamingSessionId,
    updateSendLock,
  ]);
}
