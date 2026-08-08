import { create } from 'zustand';
import type { PermissionRequestEvent, SessionStreamSnapshot } from '@/types';

export type ToolExecutionStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolExecutionSummary {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
  output?: string;
  status: ToolExecutionStatus;
  isError: boolean;
  startedAt: number;
  completedAt: number | null;
  durationMs?: number;
  streamingOutput?: string;
}

interface RuntimeStoreState {
  snapshots: Record<string, SessionStreamSnapshot>;
  setSessionSnapshot: (snapshot: SessionStreamSnapshot) => void;
  clearSessionSnapshot: (sessionId: string) => void;
}

export const useRuntimeStore = create<RuntimeStoreState>((set) => ({
  snapshots: {},
  setSessionSnapshot: (snapshot) => {
    set((state) => ({
      snapshots: {
        ...state.snapshots,
        [snapshot.sessionId]: snapshot,
      },
    }));
  },
  clearSessionSnapshot: (sessionId) => {
    set((state) => {
      const next = { ...state.snapshots };
      delete next[sessionId];
      return { snapshots: next };
    });
  },
}));

export function selectActiveStreamingSessionIds(state: RuntimeStoreState): string[] {
  return Object.values(state.snapshots)
    .filter((snapshot) => snapshot.phase === 'active')
    .map((snapshot) => snapshot.sessionId);
}

export function selectPendingPermissionSessionIds(state: RuntimeStoreState): string[] {
  return Object.values(state.snapshots)
    .filter((snapshot) => snapshot.pendingPermission && !snapshot.permissionResolved)
    .map((snapshot) => snapshot.sessionId);
}

export function selectPendingPermissions(
  state: RuntimeStoreState,
): Array<{
  sessionId: string;
  request: PermissionRequestEvent;
  resolved: SessionStreamSnapshot['permissionResolved'];
  startedAt: number;
}> {
  return Object.values(state.snapshots)
    .filter((snapshot): snapshot is SessionStreamSnapshot & { pendingPermission: PermissionRequestEvent } => Boolean(snapshot.pendingPermission))
    .map((snapshot) => ({
      sessionId: snapshot.sessionId,
      request: snapshot.pendingPermission,
      resolved: snapshot.permissionResolved,
      startedAt: snapshot.startedAt,
    }))
    .sort((left, right) => right.startedAt - left.startedAt);
}

export function buildToolExecutionSummaries(
  snapshot: SessionStreamSnapshot | null | undefined,
): ToolExecutionSummary[] {
  if (!snapshot || snapshot.toolUses.length === 0) {
    return [];
  }

  const now = Date.now();
  const effectiveCompletedAt = snapshot.completedAt ?? (snapshot.phase === 'active' ? now : null);
  const durationMs = snapshot.startedAt > 0 && effectiveCompletedAt
    ? Math.max(0, effectiveCompletedAt - snapshot.startedAt)
    : undefined;

  return snapshot.toolUses.map((toolUse) => {
    const result = snapshot.toolResults.find((entry) => entry.tool_use_id === toolUse.id);
    const output = result?.content || undefined;
    const isError = result?.is_error ?? Boolean(result?.content && /error/i.test(result.content));

    return {
      sessionId: snapshot.sessionId,
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      input: toolUse.input,
      output,
      status: result
        ? isError ? 'error' : 'success'
        : snapshot.phase === 'active' ? 'running' : 'pending',
      isError,
      startedAt: snapshot.startedAt,
      completedAt: effectiveCompletedAt,
      durationMs,
      streamingOutput:
        !result && snapshot.streamingToolOutput.trim().length > 0 ? snapshot.streamingToolOutput : undefined,
    };
  });
}
