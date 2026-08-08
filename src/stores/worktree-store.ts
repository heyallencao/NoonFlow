import { create } from 'zustand';
import type { Worktree } from '@/types';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const ACTIVE_WORKTREE_KEY = 'noonflow:active-worktree';
const LEGACY_ACTIVE_WORKTREE_KEYS = ['monolith:active-worktree'] as const;

interface ActiveWorktreeState {
  id: string;
  path: string;
}

interface WorktreeStoreState {
  /** Currently active worktree ID */
  activeWorktreeId: string;
  /** Currently active worktree path (used as workingDirectory) */
  activeWorktreePath: string;
  /** Cache: worktrees grouped by workspace path */
  worktreesByWorkspace: Record<string, Worktree[]>;

  setActiveWorktree: (id: string, path: string) => void;
  setWorktreesForWorkspace: (workspacePath: string, worktrees: Worktree[]) => void;
  clearWorktreesForWorkspace: (workspacePath: string) => void;
  hydrate: () => void;
}

function loadPersistedState(): ActiveWorktreeState {
  if (typeof window === 'undefined') return { id: '', path: '' };
  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      ACTIVE_WORKTREE_KEY,
      LEGACY_ACTIVE_WORKTREE_KEYS,
    );
    if (raw) {
      const parsed = JSON.parse(raw);
      return { id: parsed.id || '', path: parsed.path || '' };
    }
  } catch {
    // ignore
  }
  return { id: '', path: '' };
}

function persistState(state: ActiveWorktreeState): void {
  if (typeof window === 'undefined') return;
  try {
    writeStorageValue(getLocalStorageSafe(), ACTIVE_WORKTREE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export const useWorktreeStore = create<WorktreeStoreState>((set) => ({
  activeWorktreeId: '',
  activeWorktreePath: '',
  worktreesByWorkspace: {},

  setActiveWorktree: (id, path) => {
    persistState({ id, path });
    set({ activeWorktreeId: id, activeWorktreePath: path });
  },

  setWorktreesForWorkspace: (workspacePath, worktrees) => {
    set((state) => ({
      worktreesByWorkspace: {
        ...state.worktreesByWorkspace,
        [workspacePath]: worktrees,
      },
    }));
  },

  clearWorktreesForWorkspace: (workspacePath) => {
    set((state) => {
      const next = { ...state.worktreesByWorkspace };
      delete next[workspacePath];
      return { worktreesByWorkspace: next };
    });
  },

  hydrate: () => {
    const persisted = loadPersistedState();
    set({
      activeWorktreeId: persisted.id,
      activeWorktreePath: persisted.path,
    });
  },
}));
