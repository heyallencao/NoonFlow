import type { ChatSession, SessionType } from '@/types';
import { parseDBDate } from '@/lib/utils';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  removeCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const MANAGED_WORKTREE_PATTERNS = [
  '/.noonflow/worktrees/',
  '\\.noonflow\\worktrees\\',
  '/.monolith/worktrees/',
  '\\.monolith\\worktrees\\',
];

/** Returns true if the path is a managed worktree sub-path (not a real workspace) */
export function isManagedWorktreeSubPath(p: string): boolean {
  return MANAGED_WORKTREE_PATTERNS.some((pattern) => p.includes(pattern));
}

export const WORKSPACE_STORAGE_KEY = 'noonflow:workspace-folders';
export const LEGACY_WORKSPACE_STORAGE_KEYS = ['monolith:workspace-folders'] as const;
export const LAST_WORKSPACE_KEY = 'noonflow:last-working-directory';
export const LEGACY_LAST_WORKSPACE_KEYS = ['monolith:last-working-directory'] as const;
export const HIDDEN_WORKSPACE_STORAGE_KEY = 'noonflow:hidden-workspaces';
export const LEGACY_HIDDEN_WORKSPACE_STORAGE_KEYS = ['monolith:hidden-workspaces'] as const;

export interface WorkspaceStorageState {
  workspaces: string[];
  hiddenWorkspaces: string[];
  lastWorkspace: string;
}

export interface WorkspaceListItem {
  path: string;
  name: string;
  sessionCount: number;
  latestUpdatedAt: number;
  latestSessionId: string | null;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined';
}

function loadWorkspaceArray(key: string, legacyKeys: readonly string[] = []): string[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = readCompatibleStorageValue(getLocalStorageSafe(), key, legacyKeys);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeWorkspacePaths(parsed) : [];
  } catch {
    return [];
  }
}

function saveWorkspaceArray(
  key: string,
  paths: string[],
  legacyKeys: readonly string[] = [],
): string[] {
  const next = dedupeWorkspacePaths(paths);
  if (!canUseLocalStorage()) return next;

  writeStorageValue(getLocalStorageSafe(), key, JSON.stringify(next));
  return next;
}

function sameWorkspaceOrder(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function normalizeWorkspacePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function getWorkspaceName(input: string): string {
  const normalized = normalizeWorkspacePath(input);
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

export function getWorkspacePathHint(input: string): string {
  const normalized = normalizeWorkspacePath(input);
  if (!normalized) return '';

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;

  const parentParts = parts.slice(0, -1);
  const tail = parentParts.slice(-2).join(' / ');

  if (normalized.startsWith('/Users/') || normalized.startsWith('/home/')) {
    return tail ? `~ / ${tail}` : '~';
  }

  if (normalized.startsWith('/')) {
    return tail ? `… / ${tail}` : '/';
  }

  return tail || normalized;
}

export function dedupeWorkspacePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function loadStoredWorkspaces(): string[] {
  return loadWorkspaceArray(WORKSPACE_STORAGE_KEY, LEGACY_WORKSPACE_STORAGE_KEYS);
}

export function saveStoredWorkspaces(paths: string[]): string[] {
  return saveWorkspaceArray(WORKSPACE_STORAGE_KEY, paths, LEGACY_WORKSPACE_STORAGE_KEYS);
}

export function loadHiddenWorkspaces(): string[] {
  return loadWorkspaceArray(HIDDEN_WORKSPACE_STORAGE_KEY, LEGACY_HIDDEN_WORKSPACE_STORAGE_KEYS);
}

export function saveHiddenWorkspaces(paths: string[]): string[] {
  return saveWorkspaceArray(HIDDEN_WORKSPACE_STORAGE_KEY, paths, LEGACY_HIDDEN_WORKSPACE_STORAGE_KEYS);
}

export function loadLastWorkspace(): string {
  if (!canUseLocalStorage()) return '';
  try {
    return normalizeWorkspacePath(
      readCompatibleStorageValue(getLocalStorageSafe(), LAST_WORKSPACE_KEY, LEGACY_LAST_WORKSPACE_KEYS) || '',
    );
  } catch {
    return '';
  }
}

export function saveLastWorkspace(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (!canUseLocalStorage()) return normalized;

  if (normalized) {
    writeStorageValue(getLocalStorageSafe(), LAST_WORKSPACE_KEY, normalized);
  } else {
    removeCompatibleStorageValue(getLocalStorageSafe(), LAST_WORKSPACE_KEY, LEGACY_LAST_WORKSPACE_KEYS);
  }

  return normalized;
}

export function loadWorkspaceStorageState(): WorkspaceStorageState {
  const storedWorkspaces = loadStoredWorkspaces();
  const hiddenWorkspaces = loadHiddenWorkspaces();
  const lastWorkspace = loadLastWorkspace();
  const workspaces = dedupeWorkspacePaths([...storedWorkspaces, lastWorkspace]);

  if (!sameWorkspaceOrder(storedWorkspaces, workspaces)) {
    saveStoredWorkspaces(workspaces);
  }

  return {
    workspaces,
    hiddenWorkspaces,
    lastWorkspace,
  };
}

export function buildWorkspaceList({
  workspaces,
  hiddenWorkspaces = [],
  sessions,
  latestSessionType = 'chat',
}: {
  workspaces: string[];
  hiddenWorkspaces?: string[];
  sessions: ChatSession[];
  latestSessionType?: SessionType;
}): WorkspaceListItem[] {
  const map = new Map<
    string,
    WorkspaceListItem & {
      latestSessionUpdatedAt: number;
    }
  >();

  for (const workspacePath of workspaces) {
    const normalized = normalizeWorkspacePath(workspacePath);
    if (!normalized || isManagedWorktreeSubPath(normalized)) continue;
    map.set(normalized, {
      path: normalized,
      name: getWorkspaceName(normalized),
      sessionCount: 0,
      latestUpdatedAt: 0,
      latestSessionId: null,
      latestSessionUpdatedAt: 0,
    });
  }

  for (const session of sessions) {
    const normalized = normalizeWorkspacePath(session.working_directory || '');
    if (!normalized || isManagedWorktreeSubPath(normalized)) continue;

    const item = map.get(normalized) || {
      path: normalized,
      name: session.project_name || getWorkspaceName(normalized),
      sessionCount: 0,
      latestUpdatedAt: 0,
      latestSessionId: null,
      latestSessionUpdatedAt: 0,
    };

    item.sessionCount += 1;

    const updatedAt = parseDBDate(session.updated_at).getTime();
    if (updatedAt >= item.latestUpdatedAt) {
      item.latestUpdatedAt = updatedAt;
    }

    if ((session.session_type || 'chat') === latestSessionType && updatedAt >= item.latestSessionUpdatedAt) {
      item.latestSessionUpdatedAt = updatedAt;
      item.latestSessionId = session.id;
    }

    map.set(normalized, item);
  }

  const hiddenSet = new Set(hiddenWorkspaces.map((path) => normalizeWorkspacePath(path)).filter(Boolean));

  // Sort by workspace open order (stable, not affected by message updates).
  // Workspaces explicitly opened by the user follow the `workspaces` array order
  // (newest-opened first, maintained by `rememberWorkspace()`).
  // Implicitly discovered workspaces (from sessions but not in the array) sort by name at the end.
  const workspaceIndex = new Map<string, number>();
  for (let i = 0; i < workspaces.length; i++) {
    const normalized = normalizeWorkspacePath(workspaces[i]);
    if (normalized && !isManagedWorktreeSubPath(normalized)) {
      workspaceIndex.set(normalized, i);
    }
  }

  return Array.from(map.values())
    .filter((item) => !hiddenSet.has(item.path))
    .sort((left, right) => {
      const leftIdx = workspaceIndex.get(left.path);
      const rightIdx = workspaceIndex.get(right.path);
      const leftExplicit = leftIdx !== undefined;
      const rightExplicit = rightIdx !== undefined;

      // Explicitly opened workspaces come before implicitly discovered ones
      if (leftExplicit !== rightExplicit) {
        return leftExplicit ? -1 : 1;
      }

      // Both explicit: maintain open order (lower index = more recently opened = first)
      if (leftExplicit && rightExplicit) {
        return leftIdx! - rightIdx!;
      }

      // Both implicit: sort by name
      return left.name.localeCompare(right.name);
    })
    .map((item) => ({
      path: item.path,
      name: item.name,
      sessionCount: item.sessionCount,
      latestUpdatedAt: item.latestUpdatedAt,
      latestSessionId: item.latestSessionId,
    }));
}
