import { normalizeWorkspacePath } from '@/lib/workspace-utils';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const LAST_WORKTREE_SESSION_KEY = 'noonflow:last-chat-session-by-worktree';
const LEGACY_LAST_WORKTREE_SESSION_KEYS = ['monolith:last-chat-session-by-worktree'] as const;

interface LastWorktreeSessionState {
  byWorktreeId: Record<string, string>;
  byWorkingDirectory: Record<string, string>;
}

function readState(): LastWorktreeSessionState {
  if (typeof window === 'undefined') {
    return { byWorktreeId: {}, byWorkingDirectory: {} };
  }

  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      LAST_WORKTREE_SESSION_KEY,
      LEGACY_LAST_WORKTREE_SESSION_KEYS,
    );
    if (!raw) return { byWorktreeId: {}, byWorkingDirectory: {} };
    const parsed = JSON.parse(raw) as Partial<LastWorktreeSessionState>;
    return {
      byWorktreeId: parsed.byWorktreeId && typeof parsed.byWorktreeId === 'object'
        ? parsed.byWorktreeId
        : {},
      byWorkingDirectory: parsed.byWorkingDirectory && typeof parsed.byWorkingDirectory === 'object'
        ? parsed.byWorkingDirectory
        : {},
    };
  } catch {
    return { byWorktreeId: {}, byWorkingDirectory: {} };
  }
}

function writeState(state: LastWorktreeSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    writeStorageValue(getLocalStorageSafe(), LAST_WORKTREE_SESSION_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function rememberLastChatSessionForWorktree({
  sessionId,
  worktreeId,
  workingDirectory,
}: {
  sessionId: string;
  worktreeId?: string | null;
  workingDirectory?: string | null;
}): void {
  if (!sessionId) return;

  const normalizedWorktreeId = (worktreeId || '').trim();
  const normalizedDir = normalizeWorkspacePath(workingDirectory || '');
  if (!normalizedWorktreeId && !normalizedDir) return;

  const state = readState();
  let changed = false;

  if (normalizedWorktreeId && state.byWorktreeId[normalizedWorktreeId] !== sessionId) {
    state.byWorktreeId[normalizedWorktreeId] = sessionId;
    changed = true;
  }

  if (normalizedDir && state.byWorkingDirectory[normalizedDir] !== sessionId) {
    state.byWorkingDirectory[normalizedDir] = sessionId;
    changed = true;
  }

  if (changed) {
    writeState(state);
  }
}

export function findRememberedSessionForWorktree({
  worktreeId,
  workingDirectory,
  candidateSessionIds,
}: {
  worktreeId?: string | null;
  workingDirectory?: string | null;
  candidateSessionIds?: string[];
}): string | null {
  const state = readState();
  const candidateSet = candidateSessionIds?.length ? new Set(candidateSessionIds) : null;

  const normalizedWorktreeId = (worktreeId || '').trim();
  if (normalizedWorktreeId) {
    const remembered = state.byWorktreeId[normalizedWorktreeId];
    if (remembered && (!candidateSet || candidateSet.has(remembered))) {
      return remembered;
    }
  }

  const normalizedDir = normalizeWorkspacePath(workingDirectory || '');
  if (normalizedDir) {
    const remembered = state.byWorkingDirectory[normalizedDir];
    if (remembered && (!candidateSet || candidateSet.has(remembered))) {
      return remembered;
    }
  }

  return null;
}
