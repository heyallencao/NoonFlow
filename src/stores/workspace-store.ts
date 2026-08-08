import { create } from 'zustand';
import {
  loadWorkspaceStorageState,
  normalizeWorkspacePath,
  saveHiddenWorkspaces,
  saveLastWorkspace,
  saveStoredWorkspaces,
} from '@/lib/workspace-utils';

interface WorkspaceStoreState {
  workspacePaths: string[];
  hiddenWorkspaces: string[];
  lastWorkspace: string;
  hydrate: () => void;
  rememberWorkspace: (path: string) => void;
  removeWorkspace: (path: string) => void;
  setHiddenWorkspaces: (paths: string[]) => void;
  unhideWorkspace: (path: string) => void;
  setLastWorkspace: (path: string) => void;
}

function buildInitialState() {
  const storageState = loadWorkspaceStorageState();
  return {
    workspacePaths: storageState.workspaces,
    hiddenWorkspaces: storageState.hiddenWorkspaces,
    lastWorkspace: storageState.lastWorkspace,
  };
}

const EMPTY_WORKSPACE_STATE = {
  workspacePaths: [],
  hiddenWorkspaces: [],
  lastWorkspace: '',
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  ...EMPTY_WORKSPACE_STATE,
  hydrate: () => {
    const state = buildInitialState();
    set(state);
  },
  rememberWorkspace: (path) => {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized) {
      return;
    }

    set((state) => ({
      workspacePaths: saveStoredWorkspaces([normalized, ...state.workspacePaths]),
      hiddenWorkspaces: state.hiddenWorkspaces.some(
        (item) => normalizeWorkspacePath(item) === normalized,
      )
        ? saveHiddenWorkspaces(
            state.hiddenWorkspaces.filter(
              (item) => normalizeWorkspacePath(item) !== normalized,
            ),
          )
        : state.hiddenWorkspaces,
      lastWorkspace: saveLastWorkspace(normalized),
    }));
  },
  removeWorkspace: (path) => {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized) {
      return;
    }

    set((state) => {
      const nextLastWorkspace =
        normalizeWorkspacePath(state.lastWorkspace) === normalized ? saveLastWorkspace('') : state.lastWorkspace;

      return {
        workspacePaths: saveStoredWorkspaces(
          state.workspacePaths.filter((item) => normalizeWorkspacePath(item) !== normalized),
        ),
        hiddenWorkspaces: saveHiddenWorkspaces(
          state.hiddenWorkspaces.filter((item) => normalizeWorkspacePath(item) !== normalized),
        ),
        lastWorkspace: nextLastWorkspace,
      };
    });
  },
  setHiddenWorkspaces: (paths) => {
    set({ hiddenWorkspaces: saveHiddenWorkspaces(paths) });
  },
  unhideWorkspace: (path) => {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized) {
      return;
    }

    set((state) => ({
      hiddenWorkspaces: saveHiddenWorkspaces(
        state.hiddenWorkspaces.filter((item) => normalizeWorkspacePath(item) !== normalized),
      ),
    }));
  },
  setLastWorkspace: (path) => {
    set({ lastWorkspace: saveLastWorkspace(path) });
  },
}));
