"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn, parseDBDate } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorktreeCreateDialog } from "@/components/worktree/WorktreeCreateDialog";
import type { ChatSession, AssistantRuntime, Worktree, WorktreesResponse } from "@/types";
import {
  buildWorkspaceList,
  normalizeWorkspacePath,
} from "@/lib/workspace-utils";
import {
  getLocalStorageSafe,
  getSessionStorageSafe,
  readCompatibleStorageValue,
  removeCompatibleStorageValue,
  writeStorageValue,
} from "@/lib/browser-storage";
import { findRememberedSessionForWorktree } from "@/lib/worktree-last-session";
import { pickPreferredWorktreeSessionId } from "@/lib/worktree-session-preference";
import {
  publishSessionCreated,
  publishSessionDeleted,
  subscribeSessionRefresh,
  type SessionRefreshDetail,
} from '@/lib/events/session-refresh-hub';
import { useSessionsQuery } from '@/lib/queries/session-queries';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import { buildCreateSessionPreferencePayload } from '@/lib/chat-preferences';
import {
  SidebarHeader,
  SidebarNavigation,
  WorkspaceContextMenu,
  WorkspaceSection,
  type SidebarGroupConfig,
  type WorkspaceItem,
} from "./new-sidebar-sections";
import {
  Message02Icon,
  CommandLineIcon,
  DashboardSquare01Icon,
  Folder01Icon,
  Calendar03Icon,
  GitBranchIcon,
  CheckmarkBadge02Icon,
  ZapIcon,
  Plug01Icon,
  DatabaseIcon,
  CubeIcon,
} from "@hugeicons/core-free-icons";

const SKIP_WORKSPACE_AUTOPICKER_ONCE_KEY = "noonflow:skip-workspace-autopicker-once";
const LEGACY_SKIP_WORKSPACE_AUTOPICKER_ONCE_KEYS = ["monolith:skip-workspace-autopicker-once"] as const;
const SIDEBAR_COLLAPSED_KEY = "noonflow:left-sidebar-collapsed";
const LEGACY_SIDEBAR_COLLAPSED_KEYS = ["monolith:left-sidebar-collapsed"] as const;
const OPEN_TABS_UPDATED_EVENT = "noonflow:open-tabs-updated";
const WORKTREE_FETCH_TTL_MS = 3_000;

function openTabsStorageKey(workspace: string): string {
  return `noonflow:open-tabs:${workspace}`;
}

function legacyOpenTabsStorageKeys(workspace: string): string[] {
  return [`monolith:open-tabs:${workspace}`];
}

function readOpenTabIds(workspace: string): string[] {
  const normalizedWorkspace = normalizeWorkspacePath(workspace);
  if (typeof window === "undefined" || !normalizedWorkspace) return [];
  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      openTabsStorageKey(normalizedWorkspace),
      legacyOpenTabsStorageKeys(normalizedWorkspace),
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

function writeOpenTabIds(workspace: string, tabIds: string[]) {
  const normalizedWorkspace = normalizeWorkspacePath(workspace);
  if (typeof window === "undefined" || !normalizedWorkspace) return;
  const deduped = Array.from(new Set(tabIds.filter(Boolean)));
  writeStorageValue(
    getLocalStorageSafe(),
    openTabsStorageKey(normalizedWorkspace),
    JSON.stringify(deduped),
  );
  window.dispatchEvent(
    new CustomEvent(OPEN_TABS_UPDATED_EVENT, {
      detail: { workspace: normalizedWorkspace, tabIds: deduped },
    })
  );
}

const sidebarGroups = [
  {
    titleKey: "nav.groupWorkbench",
    items: [
      { href: "/dashboard", labelKey: "nav.dashboard", icon: DashboardSquare01Icon },
    ],
  },
  {
    titleKey: "nav.groupMonitor",
    items: [
      { href: "/sessions", labelKey: "nav.sessions", icon: Message02Icon },
      { href: "/tools", labelKey: "nav.tools", icon: CommandLineIcon },
    ],
  },
  {
    titleKey: "nav.groupWorkspace",
    items: [
      { href: "/repos", labelKey: "nav.repos", icon: Folder01Icon },
      { href: "/timeline", labelKey: "nav.timeline", icon: Calendar03Icon },
      { href: "/hygiene", labelKey: "nav.hygiene", icon: CheckmarkBadge02Icon },
      { href: "/work-graph", labelKey: "nav.workGraph", icon: GitBranchIcon },
    ],
  },
  {
    titleKey: "nav.groupAutomation",
    items: [
      { href: "/skills", labelKey: "nav.skills", icon: ZapIcon },
      { href: "/hooks", labelKey: "nav.hooks", icon: Plug01Icon },
      { href: "/agents", labelKey: "nav.agents", icon: CommandLineIcon },
      { href: "/mcp", labelKey: "nav.mcp", icon: CubeIcon },
      { href: "/memory", labelKey: "nav.memory", icon: DatabaseIcon },
    ],
  },
] as const satisfies ReadonlyArray<SidebarGroupConfig>;

export interface NewSidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function NewSidebar({ isMobileOpen, onMobileClose }: NewSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { workingDirectory, setWorkingDirectory } = usePanel();
  const { hasNativeFolderDialog, openNativePicker } = useNativeFolderPicker();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceItem | null>(null);
  const [deletingWorkspacePath, setDeletingWorkspacePath] = useState<string | null>(null);
  const [deleteWorktreeTarget, setDeleteWorktreeTarget] = useState<Worktree | null>(null);
  const [deletingWorktreeId, setDeletingWorktreeId] = useState<string | null>(null);
  const [deleteWorktreeStatus, setDeleteWorktreeStatus] = useState<{
    checked: boolean;
    hasChanges: boolean;
    dirtyFilesCount: number;
    untrackedFilesCount: number;
  } | null>(null);
  const [deleteWorktreeStatusLoading, setDeleteWorktreeStatusLoading] = useState(false);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [worktreeCreateTarget, setWorktreeCreateTarget] = useState<string | null>(null);
  const [deleteBranchOption, setDeleteBranchOption] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isActuallyCollapsed = collapsed && !isMobileOpen;
  const storedWorkspaces = useWorkspaceStore((state) => state.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((state) => state.hiddenWorkspaces);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrate);
  const mergeWorkspacePaths = useWorkspaceStore((state) => state.mergeWorkspacePaths);
  const rememberWorkspace = useWorkspaceStore((state) => state.rememberWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const setLastWorkspace = useWorkspaceStore((state) => state.setLastWorkspace);
  const sessionsQuery = useSessionsQuery('all');
  const sessions = useMemo<ChatSession[]>(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data?.sessions]);
  const [contextMenuWorkspace, setContextMenuWorkspace] = useState<WorkspaceItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [openTabsVersion, setOpenTabsVersion] = useState(0);
  const activeWorktreeId = useWorktreeStore((state) => state.activeWorktreeId);
  const setActiveWorktree = useWorktreeStore((state) => state.setActiveWorktree);
  const worktreesByWorkspace = useWorktreeStore((state) => state.worktreesByWorkspace);
  const setWorktreesForWorkspace = useWorktreeStore((state) => state.setWorktreesForWorkspace);
  const worktreeFetchStateRef = useRef<Map<string, {
    expiresAt: number;
    isGitRepo?: boolean;
    promise?: Promise<{ worktrees: Worktree[]; isGitRepo: boolean }>;
  }>>(new Map());
  const lastForegroundRefreshAtRef = useRef(0);

  const activeWorkspace = useMemo(
    () => normalizeWorkspacePath(workingDirectory || ""),
    [workingDirectory]
  );
  const isSettingsRoute = pathname === "/settings" || pathname.startsWith("/settings/");

  useEffect(() => {
    hydrateWorkspaces();

    try {
      const rawCollapsed = readCompatibleStorageValue(
        getLocalStorageSafe(),
        SIDEBAR_COLLAPSED_KEY,
        LEGACY_SIDEBAR_COLLAPSED_KEYS,
      );
      setCollapsed(rawCollapsed === "1");
    } catch {
      setCollapsed(false);
    }
  }, [hydrateWorkspaces]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    writeStorageValue(getLocalStorageSafe(), SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const fromSessions = sessions
      .map((session) => session.working_directory)
      .filter((path): path is string => Boolean(path));
    if (fromSessions.length > 0) {
      mergeWorkspacePaths(fromSessions);
    }
  }, [sessions, mergeWorkspacePaths]);

  useEffect(() => {
    const handler = (detail: SessionRefreshDetail) => {
      if (detail.type === 'updated') {
        return;
      }
      void sessionsQuery.refetch();
    };
    return subscribeSessionRefresh(handler);
  }, [sessionsQuery]);

  const createSessionInWorkspace = useCallback(
    async (
      workspacePath: string,
      sessionType: "chat" | "terminal" = "chat",
      worktreeId?: string,
      explicitRuntime?: AssistantRuntime,
    ) => {
      const sessionPreferences = buildCreateSessionPreferencePayload(explicitRuntime);
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          working_directory: workspacePath,
          ...sessionPreferences,
          session_type: sessionType,
          worktree_id: worktreeId || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(errData?.error || "Failed to create session");
      }

      const data = await res.json();
      const sessionId: string = data.session?.id;
      if (!sessionId) throw new Error("Missing session id");

      publishSessionCreated({ sessionId, sessionType, workingDirectory: workspacePath });
      if (sessionType === "terminal") {
        router.push(`/terminal/${sessionId}`);
      } else {
        router.push(`/chat/${sessionId}`);
      }
    },
    [router]
  );

  const openWorkspace = useCallback(
    async (workspacePath: string) => {
      const normalized = normalizeWorkspacePath(workspacePath);
      if (!normalized) return;

      setOpeningWorkspace(normalized);
      rememberWorkspace(normalized);
      setLastWorkspace(normalized);

      const latestSessions = await sessionsQuery
        .refetch()
        .then((result) => result.data?.sessions ?? sessions)
        .catch(() => sessions);

      const workspaceChatSessions = latestSessions.filter((session) => {
        if ((session.session_type || "chat") !== "chat") return false;
        return normalizeWorkspacePath(session.working_directory || "") === normalized;
      });
      const workspaceChatSessionIdSet = new Set(workspaceChatSessions.map((session) => session.id));

      const openTabIds = readOpenTabIds(normalized);
      const filteredOpenTabIds = openTabIds.filter((sessionId) => workspaceChatSessionIdSet.has(sessionId));
      if (filteredOpenTabIds.length !== openTabIds.length) {
        writeOpenTabIds(normalized, filteredOpenTabIds);
      }
      const candidateSessionIds = workspaceChatSessions.map((session) => session.id);
      const rememberedSessionId = findRememberedSessionForWorktree({
        workingDirectory: normalized,
        candidateSessionIds,
      });
      const preferredSessionId = pickPreferredWorktreeSessionId({
        candidateSessionIds,
        openTabIds: filteredOpenTabIds,
        rememberedSessionId,
      });
      if (preferredSessionId) {
        router.push(`/chat/${preferredSessionId}`);
        setOpeningWorkspace(null);
        return;
      }

      let latestSession: ChatSession | null = null;
      for (const session of workspaceChatSessions) {
        if (
          !latestSession ||
          parseDBDate(session.updated_at).getTime() >
            parseDBDate(latestSession.updated_at).getTime()
        ) {
          latestSession = session;
        }
      }

      try {
        if (latestSession) {
          router.push(`/chat/${latestSession.id}`);
          onMobileClose?.();
          return;
        }
        await createSessionInWorkspace(normalized, "chat");
        onMobileClose?.();
      } finally {
        setOpeningWorkspace(null);
      }
    },
    [sessions, sessionsQuery, rememberWorkspace, setLastWorkspace, router, createSessionInWorkspace, onMobileClose]
  );

  const deleteWorkspace = useCallback(async () => {
    if (!deleteTarget || deletingWorkspacePath) return;
    const normalized = normalizeWorkspacePath(deleteTarget.path);
    if (!normalized) return;

    setDeletingWorkspacePath(normalized);
    try {
      const res = await fetch("/api/workspaces/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspacePath: normalized }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t("workspacePanel.deleteFailed"));
      }
      const payload = (await res.json().catch(() => null)) as
        | { deletedSessionIds?: string[] }
        | null;
      const deletedSessionIds = payload?.deletedSessionIds || [];
      for (const sessionId of deletedSessionIds) {
        window.electronAPI?.terminal?.close({ sessionId }).catch(() => {});
      }

      removeWorkspace(normalized);

      if (typeof window !== "undefined") {
        removeCompatibleStorageValue(
          getLocalStorageSafe(),
          openTabsStorageKey(normalized),
          legacyOpenTabsStorageKeys(normalized),
        );
      }

      if (activeWorkspace === normalized) {
        setWorkingDirectory("");
        if (typeof window !== "undefined") {
          writeStorageValue(getSessionStorageSafe(), SKIP_WORKSPACE_AUTOPICKER_ONCE_KEY, "1");
        }
        router.push("/chat");
      }

      await sessionsQuery.refetch();
      publishSessionDeleted({ sessionIds: deletedSessionIds });
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("workspacePanel.deleteFailed");
      toast.error(message);
    } finally {
      setDeletingWorkspacePath(null);
    }
  }, [
    deleteTarget,
    deletingWorkspacePath,
    t,
    activeWorkspace,
    removeWorkspace,
    sessionsQuery,
    setWorkingDirectory,
    router,
  ]);

  const openFolderPicker = useCallback(async () => {
    const defaultPath = activeWorkspace || undefined;
    if (hasNativeFolderDialog) {
      const selectedPath = await openNativePicker({
        defaultPath,
        title: t("folderPicker.title"),
      });
      if (selectedPath) {
        await openWorkspace(selectedPath);
      }
      return;
    }
    setFolderPickerOpen(true);
  }, [hasNativeFolderDialog, openNativePicker, t, activeWorkspace, openWorkspace]);

  const workspaceItems = useMemo<WorkspaceItem[]>(
    () => buildWorkspaceList({ workspaces: storedWorkspaces, hiddenWorkspaces, sessions }),
    [storedWorkspaces, sessions, hiddenWorkspaces]
  );
  const worktreeSessionCounts = useMemo<Record<string, number>>(() => {
    // Force recompute when open-tab storage updates in the same window.
    void openTabsVersion;
    const counts: Record<string, number> = {};
    const activeSessionById = new Map(
      sessions
        .filter((session) => session.status === 'active' && (session.session_type || 'chat') === 'chat')
        .map((session) => [session.id, session] as const)
    );

    for (const workspace of workspaceItems) {
      const openTabIds = readOpenTabIds(workspace.path);
      if (openTabIds.length === 0) continue;

      const worktrees = worktreesByWorkspace[workspace.path] || [];
      const defaultWorktree = worktrees.find((worktree) => worktree.is_default);

      for (const sessionId of openTabIds) {
        const session = activeSessionById.get(sessionId);
        if (!session) continue;

        if (session.worktree_id) {
          counts[session.worktree_id] = (counts[session.worktree_id] || 0) + 1;
          continue;
        }

        if (!defaultWorktree) continue;
        const sessionWorkspace = normalizeWorkspacePath(session.working_directory || '');
        const defaultWorkspace = normalizeWorkspacePath(defaultWorktree.workspace_path || workspace.path);
        if (sessionWorkspace && sessionWorkspace === defaultWorkspace) {
          counts[defaultWorktree.id] = (counts[defaultWorktree.id] || 0) + 1;
        }
      }
    }

    return counts;
  }, [openTabsVersion, sessions, workspaceItems, worktreesByWorkspace]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenTabsUpdated = () => {
      setOpenTabsVersion((version) => version + 1);
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key?.startsWith('noonflow:open-tabs:')
        && !event.key?.startsWith('monolith:open-tabs:')
      ) {
        return;
      }
      setOpenTabsVersion((version) => version + 1);
    };

    window.addEventListener(OPEN_TABS_UPDATED_EVENT, handleOpenTabsUpdated as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(OPEN_TABS_UPDATED_EVENT, handleOpenTabsUpdated as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Fetch worktrees when a workspace is expanded
  const invalidateWorktreeFetch = useCallback((wsPath: string) => {
    const normalized = normalizeWorkspacePath(wsPath);
    if (!normalized) return;
    worktreeFetchStateRef.current.delete(normalized);
  }, []);

  const fetchWorktrees = useCallback(async (
    wsPath: string,
    options?: { force?: boolean },
  ): Promise<{ worktrees: Worktree[]; isGitRepo: boolean }> => {
    const normalized = normalizeWorkspacePath(wsPath);
    if (!normalized) {
      return { worktrees: [], isGitRepo: false };
    }

    const now = Date.now();
    const existing = worktreeFetchStateRef.current.get(normalized);
    if (!options?.force && existing?.promise) {
      return existing.promise;
    }
    if (!options?.force && existing && existing.expiresAt > now) {
      return {
        worktrees: useWorktreeStore.getState().worktreesByWorkspace[normalized] || [],
        isGitRepo: Boolean(existing.isGitRepo),
      };
    }

    const request: Promise<{ worktrees: Worktree[]; isGitRepo: boolean }> = fetch(`/api/worktrees?workspace=${encodeURIComponent(normalized)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to fetch worktrees');
        }
        const data = await res.json() as WorktreesResponse;
        const nextWorktrees = data.worktrees || [];
        const isGitRepo = Boolean(data.isGitRepo);
        const current = worktreeFetchStateRef.current.get(normalized);
        if (current?.promise === request) {
          setWorktreesForWorkspace(normalized, nextWorktrees);
          worktreeFetchStateRef.current.set(normalized, {
            expiresAt: Date.now() + WORKTREE_FETCH_TTL_MS,
            isGitRepo,
          });
        }
        return { worktrees: nextWorktrees, isGitRepo };
      })
      .catch(() => {
        const current = worktreeFetchStateRef.current.get(normalized);
        if (current?.promise === request) {
          worktreeFetchStateRef.current.set(normalized, {
            expiresAt: Date.now() + 500,
            isGitRepo: current?.isGitRepo,
          });
        }
        return {
          worktrees: useWorktreeStore.getState().worktreesByWorkspace[normalized] || [],
          isGitRepo: Boolean(current?.isGitRepo),
        };
      });

    worktreeFetchStateRef.current.set(normalized, {
      expiresAt: now + WORKTREE_FETCH_TTL_MS,
      promise: request,
    });
    return request;
  }, [setWorktreesForWorkspace]);

  const refreshVisibleWorktrees = useCallback(() => {
    const workspacePaths = new Set<string>();

    if (activeWorkspace) {
      workspacePaths.add(activeWorkspace);
    }

    for (const workspacePath of expandedWorkspaces) {
      workspacePaths.add(workspacePath);
    }

    for (const workspacePath of workspacePaths) {
      void fetchWorktrees(workspacePath);
    }
  }, [activeWorkspace, expandedWorkspaces, fetchWorktrees]);

  const toggleWorkspaceExpand = useCallback((wsPath: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsPath)) {
        next.delete(wsPath);
      } else {
        next.add(wsPath);
        // Always refetch on expand so default branch/name changes show up immediately.
        void fetchWorktrees(wsPath, { force: true });
      }
      return next;
    });
  }, [fetchWorktrees]);

  const handleWorktreeSelect = useCallback(async (wt: Worktree) => {
    setActiveWorktree(wt.id, wt.worktree_path);
    setLastWorkspace(wt.workspace_path);

    const latestSessions = await sessionsQuery
      .refetch()
      .then((result) => result.data?.sessions ?? sessions)
      .catch(() => sessions);

    const normalizedWorktreePath = normalizeWorkspacePath(wt.worktree_path);
    const normalizedWorkspacePath = normalizeWorkspacePath(wt.workspace_path);

    // Navigate to last-opened tab in this worktree first, then remembered/latest.
    // Worktree ownership uses both worktree_id and working_directory fallback
    // to support legacy sessions created before worktree_id was persisted.
    const wtSessions = latestSessions.filter((session) => {
      if ((session.session_type || 'chat') !== 'chat') return false;

      const normalizedSessionDir = normalizeWorkspacePath(session.working_directory || '');
      if (session.worktree_id && session.worktree_id === wt.id) {
        return true;
      }
      if (normalizedSessionDir && normalizedSessionDir === normalizedWorktreePath) {
        return true;
      }
      if (
        wt.is_default
        && !session.worktree_id
        && normalizedSessionDir
        && normalizedSessionDir === normalizedWorkspacePath
      ) {
        return true;
      }
      return false;
    });

    const candidateSessionIds = wtSessions.map((session) => session.id);
    const candidateSessionIdSet = new Set(candidateSessionIds);

    const openTabsInWorktreePath = readOpenTabIds(normalizedWorktreePath);
    const openTabsInWorkspacePath = normalizedWorkspacePath !== normalizedWorktreePath
      ? readOpenTabIds(normalizedWorkspacePath)
      : [];
    const preferredOpenTabIds = [
      ...openTabsInWorktreePath,
      ...openTabsInWorkspacePath,
    ]
      .filter((sessionId, index, array) => array.indexOf(sessionId) === index)
      .filter((sessionId) => candidateSessionIdSet.has(sessionId));

    if (wtSessions.length > 0) {
      const sessionDir = normalizeWorkspacePath(wt.is_default ? wt.workspace_path : wt.worktree_path);
      const rememberedSessionId = findRememberedSessionForWorktree({
        worktreeId: wt.id,
        workingDirectory: sessionDir,
        candidateSessionIds,
      });
      const preferredSessionId = pickPreferredWorktreeSessionId({
        candidateSessionIds,
        openTabIds: preferredOpenTabIds,
        rememberedSessionId,
      });
      if (preferredSessionId) {
        router.push(`/chat/${preferredSessionId}`);
        onMobileClose?.();
        return;
      }

      const latest = [...wtSessions]
        .sort((a, b) => parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime())[0];
      router.push(`/chat/${latest.id}`);
      onMobileClose?.();
    } else {
      // For non-default worktrees, use workspace_path as working_directory
      // (the worktree_path may not exist on disk if git worktree creation failed)
      const sessionDir = wt.is_default ? wt.workspace_path : wt.worktree_path;
      try {
        await createSessionInWorkspace(sessionDir, "chat", wt.id);
      } catch {
        // Fallback: try with workspace_path if worktree_path failed
        if (!wt.is_default) {
          await createSessionInWorkspace(wt.workspace_path, "chat", wt.id);
        }
      }
      onMobileClose?.();
    }
  }, [
    setActiveWorktree,
    setLastWorkspace,
    sessionsQuery,
    sessions,
    router,
    createSessionInWorkspace,
    onMobileClose,
  ]);

  const handleWorktreeDelete = useCallback((worktree: Worktree) => {
    if (deletingWorktreeId) return;
    setDeleteWorktreeTarget(worktree);
    setDeleteBranchOption(false);
    setDeleteWorktreeStatus(null);
    setDeleteWorktreeStatusLoading(true);

    void fetch(`/api/worktrees?id=${encodeURIComponent(worktree.id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null) as {
          deleteStatus?: {
            checked: boolean;
            hasChanges: boolean;
            dirtyFilesCount: number;
            untrackedFilesCount: number;
          };
        } | null;

        if (!res.ok) {
          throw new Error('Failed to inspect worktree');
        }

        setDeleteWorktreeStatus(data?.deleteStatus || {
          checked: false,
          hasChanges: false,
          dirtyFilesCount: 0,
          untrackedFilesCount: 0,
        });
      })
      .catch(() => {
        setDeleteWorktreeStatus({
          checked: false,
          hasChanges: false,
          dirtyFilesCount: 0,
          untrackedFilesCount: 0,
        });
      })
      .finally(() => {
        setDeleteWorktreeStatusLoading(false);
      });
  }, [deletingWorktreeId]);

  const confirmWorktreeDelete = useCallback(async () => {
    if (!deleteWorktreeTarget || deletingWorktreeId) return;

    const worktree = deleteWorktreeTarget;
    const currentSessionId = pathname.startsWith('/chat/') ? pathname.split('/')[2] || '' : '';
    setDeletingWorktreeId(worktree.id);
    try {
      const url = `/api/worktrees?id=${encodeURIComponent(worktree.id)}&confirm=true${deleteBranchOption ? '&deleteBranch=true' : ''}${deleteWorktreeStatus?.hasChanges ? '&dirtyConfirmed=true' : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
          deleteStatus?: {
            checked: boolean;
            hasChanges: boolean;
            dirtyFilesCount: number;
            untrackedFilesCount: number;
          };
        } | null;

        if (data?.code === 'DIRTY_WORKTREE_CONFIRMATION_REQUIRED' && data.deleteStatus) {
          setDeleteWorktreeStatus(data.deleteStatus);
          return;
        }

        throw new Error(data?.error || t('workspacePanel.worktreeDeleteAction'));
      }

      const payload = (await res.json().catch(() => null)) as { deletedSessionIds?: string[] } | null;
      const deletedSessionIds = payload?.deletedSessionIds || [];
      for (const sessionId of deletedSessionIds) {
        window.electronAPI?.terminal?.close({ sessionId }).catch(() => {});
      }
      if (deletedSessionIds.length > 0) {
        publishSessionDeleted({ sessionIds: deletedSessionIds });
      }

      invalidateWorktreeFetch(worktree.workspace_path);
      const { worktrees: nextWorktrees } = await fetchWorktrees(worktree.workspace_path, { force: true });
      const defaultWorktree = nextWorktrees.find((item) => item.is_default);

      if (activeWorktreeId === worktree.id && defaultWorktree) {
        setActiveWorktree(defaultWorktree.id, defaultWorktree.worktree_path);
        setWorkingDirectory(defaultWorktree.worktree_path);
      }

      const latestSessions = await sessionsQuery
        .refetch()
        .then((result) => result.data?.sessions ?? sessions)
        .catch(() => sessions);

      if (currentSessionId && deletedSessionIds.includes(currentSessionId)) {
        if (!defaultWorktree) {
          router.push('/chat');
        } else {
          const fallbackSessions = latestSessions.filter((session) => {
            if ((session.session_type || 'chat') !== 'chat') return false;
            if (session.worktree_id) return session.worktree_id === defaultWorktree.id;
            return normalizeWorkspacePath(session.working_directory || '') === normalizeWorkspacePath(defaultWorktree.workspace_path);
          });
          const fallbackSession = fallbackSessions
            .sort((a, b) => parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime())[0];

          if (fallbackSession) {
            router.push(`/chat/${fallbackSession.id}`);
          } else {
            await createSessionInWorkspace(defaultWorktree.worktree_path || defaultWorktree.workspace_path, 'chat', defaultWorktree.id);
          }
        }
      }

      setDeleteWorktreeTarget(null);
      setDeleteWorktreeStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('workspacePanel.worktreeDeleteAction');
      toast.error(message);
    } finally {
      setDeletingWorktreeId(null);
    }
  }, [
    activeWorktreeId,
    deleteWorktreeTarget,
    deleteWorktreeStatus,
    deleteBranchOption,
    deletingWorktreeId,
    fetchWorktrees,
    invalidateWorktreeFetch,
    pathname,
    router,
    sessions,
    sessionsQuery,
    setActiveWorktree,
    setWorkingDirectory,
    t,
    createSessionInWorkspace,
  ]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenuPosition) return;

    const handleClick = () => {
      setContextMenuPosition(null);
      setContextMenuWorkspace(null);
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenuPosition]);

  // Auto-expand active workspace
  useEffect(() => {
    if (!activeWorkspace) return;

    let cancelled = false;

    void fetchWorktrees(activeWorkspace).then(({ isGitRepo }) => {
      if (cancelled || !isGitRepo) return;
      setExpandedWorkspaces((prev) => {
        if (prev.has(activeWorkspace)) return prev;
        const next = new Set(prev);
        next.add(activeWorkspace);
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, fetchWorktrees]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const refreshOnForeground = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < WORKTREE_FETCH_TTL_MS) {
        return;
      }
      lastForegroundRefreshAtRef.current = now;
      refreshVisibleWorktrees();
    };

    window.addEventListener('focus', refreshOnForeground);
    document.addEventListener('visibilitychange', refreshOnForeground);

    return () => {
      window.removeEventListener('focus', refreshOnForeground);
      document.removeEventListener('visibilitychange', refreshOnForeground);
    };
  }, [refreshVisibleWorktrees]);

  const handleWorkspaceContextMenu = useCallback((e: ReactMouseEvent, workspace: WorkspaceItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuWorkspace(workspace);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenInFinder = useCallback(async (workspacePath: string) => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.shell?.openPath) {
        await window.electronAPI.shell.openPath(workspacePath);
      }
    } catch (err) {
      console.error('Failed to open in Finder:', err);
    }
    setContextMenuPosition(null);
    setContextMenuWorkspace(null);
  }, []);

  const handleCloseWorkspace = useCallback((workspace: WorkspaceItem) => {
    setDeleteTarget(workspace);
    setContextMenuPosition(null);
    setContextMenuWorkspace(null);
  }, []);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-2 left-2 z-[70] flex w-[252px] shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-bg-secondary text-sidebar-foreground shadow-2xl transition-[transform,width] duration-200",
          isMobileOpen
            ? "translate-x-0"
            : "-translate-x-[calc(100%+16px)] pointer-events-none",
          "lg:relative lg:inset-auto lg:left-auto lg:z-auto lg:m-2 lg:mr-0 lg:h-[calc(100%-1rem)] lg:translate-x-0 lg:pointer-events-auto lg:shadow-none",
          isActuallyCollapsed ? "lg:w-[78px]" : "lg:w-[252px]"
        )}
      >
        {/* 顶部渐变特效 */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

        <div className={cn("relative flex h-full w-full flex-col pb-4", isActuallyCollapsed ? "pt-8" : "pt-10")}>
          <div
            className="w-full h-8 drag-region absolute top-0 left-0"
            data-window-drag-region
            style={{ WebkitAppRegion: "drag" } as CSSProperties}
          />
          <div className={cn("w-full shrink-0", isActuallyCollapsed ? "h-1.5" : "h-3")} />
          <SidebarHeader
            collapsed={isActuallyCollapsed}
            isSettingsRoute={isSettingsRoute}
            isMobileOpen={!!isMobileOpen}
            onMobileClose={onMobileClose}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            t={t}
          />

        <div
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <SidebarNavigation
            collapsed={isActuallyCollapsed}
            pathname={pathname}
            groups={sidebarGroups}
            t={t}
          />
          <WorkspaceSection
            collapsed={isActuallyCollapsed}
            workspaceItems={workspaceItems}
            activeWorkspace={activeWorkspace}
            openingWorkspace={openingWorkspace}
            deletingWorkspacePath={deletingWorkspacePath}
            expandedWorkspaces={expandedWorkspaces}
            worktreesByWorkspace={worktreesByWorkspace}
            worktreeSessionCounts={worktreeSessionCounts}
            activeWorktreeId={activeWorktreeId}
            onOpenFolderPicker={() => {
              void openFolderPicker();
            }}
            onOpenWorkspace={(path) => {
              void openWorkspace(path);
            }}
            onToggleWorkspaceExpand={toggleWorkspaceExpand}
            onSetWorktreeCreateTarget={(workspacePath) => {
              setWorktreeCreateTarget(workspacePath);
            }}
            onWorktreeSelect={(worktree) => {
              void handleWorktreeSelect(worktree);
            }}
            onWorktreeDelete={handleWorktreeDelete}
            onWorkspaceContextMenu={handleWorkspaceContextMenu}
            t={t}
          />
        </div>
      </div>

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(path) => {
          void openWorkspace(path);
        }}
        initialPath={activeWorkspace || undefined}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deletingWorkspacePath) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workspacePanel.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sidebar-foreground/76">
                <p>{t("workspacePanel.deleteConfirmDesc", { name: deleteTarget?.name || "" })}</p>
                {deleteTarget?.path ? (
                  <p className="rounded-lg border border-border-subtle bg-bg-tertiary px-2 py-1 text-[11px] text-sidebar-foreground/70">
                    {deleteTarget.path}
                  </p>
                ) : null}
                <p className="text-red-200/88">{t("workspacePanel.deleteConfirmWarning")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingWorkspacePath}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!deletingWorkspacePath}
              onClick={(e) => {
                e.preventDefault();
                void deleteWorkspace();
              }}
            >
              {deletingWorkspacePath ? t("workspacePanel.deleting") : t("workspacePanel.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteWorktreeTarget}
        onOpenChange={(open) => {
          if (!open && !deletingWorktreeId) {
            setDeleteWorktreeTarget(null);
            setDeleteWorktreeStatus(null);
            setDeleteWorktreeStatusLoading(false);
          }
        }}
      >
        <AlertDialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workspacePanel.worktreeDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sidebar-foreground/76">
                <p>
                  {t("workspacePanel.worktreeDeleteConfirmDesc", {
                    name: deleteWorktreeTarget?.name || deleteWorktreeTarget?.branch || "",
                  })}
                </p>
                {deleteWorktreeTarget?.worktree_path ? (
                  <p className="rounded-lg border border-border-subtle bg-bg-tertiary px-2 py-1 text-[11px] text-sidebar-foreground/70">
                    {deleteWorktreeTarget.worktree_path}
                  </p>
                ) : null}

                {deleteWorktreeStatusLoading ? (
                  <div className="rounded-lg border border-border-subtle bg-bg-tertiary/40 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-sidebar-foreground/70">
                      {t("workspacePanel.worktreeDeleteCheckingChanges")}
                    </p>
                  </div>
                ) : null}

                {!deleteWorktreeStatusLoading && deleteWorktreeStatus?.checked === false ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-amber-300/90">
                      {t("workspacePanel.worktreeDeleteCheckFailed")}
                    </p>
                  </div>
                ) : null}

                {!deleteWorktreeStatusLoading && deleteWorktreeStatus?.hasChanges ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                    <p className="text-[11px] leading-relaxed text-red-300/90">
                      {t("workspacePanel.worktreeDeleteDirtyWarning", {
                        count: deleteWorktreeStatus.dirtyFilesCount + deleteWorktreeStatus.untrackedFilesCount,
                        dirty: deleteWorktreeStatus.dirtyFilesCount,
                        untracked: deleteWorktreeStatus.untrackedFilesCount,
                      })}
                    </p>
                  </div>
                ) : null}

                {deleteWorktreeTarget?.branch ? (
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-subtle/50 bg-bg-tertiary/30 p-3 transition-colors hover:border-border-subtle hover:bg-bg-tertiary/50">
                      <input
                        type="checkbox"
                        checked={deleteBranchOption}
                        onChange={(e) => setDeleteBranchOption(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-default bg-bg-primary text-sidebar-foreground focus:ring-2 focus:ring-border-accent"
                      />
                      <div className="flex-1 space-y-1">
                        <span className="block text-[12px] font-medium text-sidebar-foreground/90">
                          {t("workspacePanel.deleteBranchOption")}
                        </span>
                        <code className="block rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-sidebar-foreground/80">
                          {deleteWorktreeTarget.branch}
                        </code>
                      </div>
                    </label>

                    {deleteBranchOption ? (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                        <p className="text-[11px] leading-relaxed text-red-400/90">
                          {t("workspacePanel.deleteBranchWarning")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-red-200/88">
                  {t("workspacePanel.worktreeDeleteConfirmWarning")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingWorktreeId}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!deletingWorktreeId || deleteWorktreeStatusLoading}
              onClick={(e) => {
                e.preventDefault();
                void confirmWorktreeDelete();
              }}
            >
              {deletingWorktreeId
                ? t("workspacePanel.deleting")
                : deleteBranchOption
                ? t("workspacePanel.deleteWorktreeAndBranch")
                : t("workspacePanel.worktreeDeleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {worktreeCreateTarget ? (
        <WorktreeCreateDialog
          open={!!worktreeCreateTarget}
          onOpenChange={(open) => {
            if (!open) {
              setWorktreeCreateTarget(null);
            }
          }}
          workspacePath={worktreeCreateTarget}
          currentCount={(worktreesByWorkspace[worktreeCreateTarget] || []).filter((worktree) => !worktree.is_default).length}
          maxCount={8}
          onCreated={() => {
            invalidateWorktreeFetch(worktreeCreateTarget);
            void fetchWorktrees(worktreeCreateTarget, { force: true });
          }}
        />
      ) : null}

    </aside>

      <WorkspaceContextMenu
        contextMenuPosition={contextMenuPosition}
        contextMenuWorkspace={contextMenuWorkspace}
        onOpenInFinder={handleOpenInFinder}
        onCloseWorkspace={handleCloseWorkspace}
        t={t}
      />
    </>
  );
}
