"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DashboardSquare01Icon,
  ZapIcon,
  Plug01Icon,
  DatabaseIcon,
  CubeIcon,
  CommandLineIcon,
} from "@hugeicons/core-free-icons";

import { FolderPicker } from "@/components/chat/FolderPicker";
import { WorktreeCreateDialog } from "@/components/worktree/WorktreeCreateDialog";
import { WorktreeDeleteDialog } from "@/components/worktree/WorktreeDeleteDialog";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { buildCreateSessionPreferencePayload } from "@/lib/chat-preferences";
import { publishSessionCreated } from "@/lib/events/session-refresh-hub";
import { fetchSessionsForOpenedWorkspaces, useSessionsQuery } from "@/lib/queries/session-queries";
import { cn, parseDBDate } from "@/lib/utils";
import { buildWorkspaceList, normalizeWorkspacePath } from "@/lib/workspace-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AssistantRuntime, ChatSession, Worktree, WorktreesResponse } from "@/types";
import {
  SidebarHeader,
  SidebarNavigation,
  WorkspaceContextMenu,
  WorkspaceSection,
  type SidebarGroupConfig,
  type WorkspaceItem,
} from "./new-sidebar-sections";

const sidebarGroups = [
  {
    titleKey: "nav.groupWorkbench",
    items: [
      { href: "/dashboard", labelKey: "nav.dashboard", icon: DashboardSquare01Icon },
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

const SIDEBAR_COLLAPSED_KEY = "noonflow:left-sidebar-collapsed";

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
  const storedWorkspaces = useWorkspaceStore((state) => state.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((state) => state.hiddenWorkspaces);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrate);
  const rememberWorkspace = useWorkspaceStore((state) => state.rememberWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const setLastWorkspace = useWorkspaceStore((state) => state.setLastWorkspace);
  const [collapsed, setCollapsed] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState<string | null>(null);
  const [contextMenuWorkspace, setContextMenuWorkspace] = useState<WorkspaceItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [worktreesByWorkspace, setWorktreesByWorkspace] = useState<Record<string, Worktree[]>>({});
  const [gitWorkspacePaths, setGitWorkspacePaths] = useState<Record<string, boolean | undefined>>({});
  const [worktreeLimitsByWorkspace, setWorktreeLimitsByWorkspace] = useState<Record<string, number>>({});
  const [loadingWorktreePaths, setLoadingWorktreePaths] = useState<Set<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [worktreeCreateTarget, setWorktreeCreateTarget] = useState<string | null>(null);
  const [deleteWorktreeTarget, setDeleteWorktreeTarget] = useState<Worktree | null>(null);
  const initializedWorktreeExpansionRef = useRef(new Set<string>());

  const sessionWorkspacePaths = useMemo(() => {
    const paths = [...storedWorkspaces];
    for (const worktrees of Object.values(worktreesByWorkspace)) {
      for (const worktree of worktrees) paths.push(worktree.worktree_path);
    }
    return Array.from(new Set(paths.map(normalizeWorkspacePath).filter(Boolean)));
  }, [storedWorkspaces, worktreesByWorkspace]);
  const sessionsQuery = useSessionsQuery("all", sessionWorkspacePaths);
  const sessions = useMemo<ChatSession[]>(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data?.sessions]);

  const activeCheckoutPath = useMemo(
    () => normalizeWorkspacePath(workingDirectory || ""),
    [workingDirectory],
  );
  const activeProjectPath = useMemo(() => {
    for (const workspacePath of storedWorkspaces) {
      const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
      if (normalizedWorkspace === activeCheckoutPath) return normalizedWorkspace;
      if ((worktreesByWorkspace[normalizedWorkspace] || []).some(
        (worktree) => normalizeWorkspacePath(worktree.worktree_path) === activeCheckoutPath,
      )) {
        return normalizedWorkspace;
      }
    }
    return activeCheckoutPath;
  }, [activeCheckoutPath, storedWorkspaces, worktreesByWorkspace]);
  const isActuallyCollapsed = collapsed && !isMobileOpen;
  const isSettingsRoute = pathname === "/settings" || pathname.startsWith("/settings/");

  useEffect(() => {
    hydrateWorkspaces();
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, [hydrateWorkspaces]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!contextMenuPosition) return;
    const close = () => {
      setContextMenuPosition(null);
      setContextMenuWorkspace(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenuPosition]);

  const refreshWorktrees = useCallback(async (workspacePath: string) => {
    const normalized = normalizeWorkspacePath(workspacePath);
    if (!normalized) return null;

    setLoadingWorktreePaths((current) => new Set(current).add(normalized));
    try {
      const response = await fetch(`/api/worktrees?workspace=${encodeURIComponent(normalized)}`);
      const payload = await response.json().catch(() => null) as (WorktreesResponse & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "Failed to load worktrees");

      setGitWorkspacePaths((current) => ({ ...current, [normalized]: payload.is_git_repo }));
      setWorktreeLimitsByWorkspace((current) => ({
        ...current,
        [normalized]: payload.max_managed_worktrees,
      }));
      setWorktreesByWorkspace((current) => ({
        ...current,
        [normalized]: payload.worktrees || [],
      }));

      if (!initializedWorktreeExpansionRef.current.has(normalized)) {
        initializedWorktreeExpansionRef.current.add(normalized);
        if ((payload.worktrees || []).some((worktree) => !worktree.is_default && !worktree.is_prunable)) {
          setExpandedWorkspaces((current) => new Set(current).add(normalized));
        }
      }
      return payload;
    } catch {
      setGitWorkspacePaths((current) => ({ ...current, [normalized]: false }));
      return null;
    } finally {
      setLoadingWorktreePaths((current) => {
        const next = new Set(current);
        next.delete(normalized);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    for (const workspacePath of storedWorkspaces) {
      void refreshWorktrees(workspacePath);
    }
  }, [refreshWorktrees, storedWorkspaces]);

  const createSessionInWorkspace = useCallback(async (
    workspacePath: string,
    explicitRuntime?: AssistantRuntime,
  ) => {
    const response = await fetch("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        working_directory: workspacePath,
        ...buildCreateSessionPreferencePayload(explicitRuntime),
        session_type: "chat",
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || "Failed to create session");
    }
    const payload = await response.json() as { session?: { id?: string } };
    const sessionId = payload.session?.id;
    if (!sessionId) throw new Error("Missing session id");
    publishSessionCreated({ sessionId, sessionType: "chat", workingDirectory: workspacePath });
    router.push(`/chat/${sessionId}`);
  }, [router]);

  const openCheckout = useCallback(async (workspacePath: string, checkoutPath: string) => {
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
    const normalizedCheckout = normalizeWorkspacePath(checkoutPath);
    if (!normalizedWorkspace || !normalizedCheckout) return;

    setOpeningWorkspace(normalizedCheckout);
    rememberWorkspace(normalizedWorkspace);
    setLastWorkspace(normalizedWorkspace);

    try {
      const latestSessions = await fetchSessionsForOpenedWorkspaces("all", [normalizedCheckout])
        .then((result) => result.sessions)
        .catch(() => sessions);
      const latestNativeSession = latestSessions
        .filter((session) => (
          session.session_type === "chat"
          && normalizeWorkspacePath(session.working_directory || "") === normalizedCheckout
        ))
        .sort((left, right) => parseDBDate(right.updated_at).getTime() - parseDBDate(left.updated_at).getTime())[0];

      if (latestNativeSession) {
        router.push(`/chat/${latestNativeSession.id}`);
      } else {
        await createSessionInWorkspace(normalizedCheckout);
      }
      onMobileClose?.();
    } finally {
      setOpeningWorkspace(null);
    }
  }, [createSessionInWorkspace, onMobileClose, rememberWorkspace, router, sessions, setLastWorkspace]);

  const openWorkspace = useCallback(async (workspacePath: string) => {
    await openCheckout(workspacePath, workspacePath);
  }, [openCheckout]);

  const openFolderPicker = useCallback(async () => {
    if (hasNativeFolderDialog) {
      const selectedPath = await openNativePicker({
        defaultPath: activeProjectPath || undefined,
        title: t("folderPicker.title"),
      });
      if (selectedPath) await openWorkspace(selectedPath);
      return;
    }
    setFolderPickerOpen(true);
  }, [activeProjectPath, hasNativeFolderDialog, openNativePicker, openWorkspace, t]);

  const workspaceItems = useMemo<WorkspaceItem[]>(
    () => buildWorkspaceList({ workspaces: storedWorkspaces, hiddenWorkspaces, sessions }),
    [hiddenWorkspaces, sessions, storedWorkspaces],
  );

  const worktreeSessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const session of sessions) {
      const sessionPath = normalizeWorkspacePath(session.working_directory || "");
      if (!sessionPath) continue;
      counts[sessionPath] = (counts[sessionPath] || 0) + 1;
    }
    return counts;
  }, [sessions]);

  const toggleWorkspaceExpand = useCallback((workspacePath: string) => {
    const normalized = normalizeWorkspacePath(workspacePath);
    setExpandedWorkspaces((current) => {
      const next = new Set(current);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
    if (!expandedWorkspaces.has(normalized)) void refreshWorktrees(normalized);
  }, [expandedWorkspaces, refreshWorktrees]);

  const handleWorkspaceContextMenu = useCallback((event: ReactMouseEvent, workspace: WorkspaceItem) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenuWorkspace(workspace);
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  }, []);

  return (
    <>
      {isMobileOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 lg:hidden" onClick={onMobileClose} />
      )}
      <aside
        className={cn(
          "fixed inset-y-2 left-2 z-[70] flex w-[252px] shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-bg-secondary text-sidebar-foreground shadow-2xl transition-[transform,width] duration-200",
          isMobileOpen ? "translate-x-0" : "-translate-x-[calc(100%+16px)] pointer-events-none",
          "lg:relative lg:inset-auto lg:left-auto lg:z-auto lg:m-2 lg:mr-0 lg:h-[calc(100%-1rem)] lg:translate-x-0 lg:pointer-events-auto lg:shadow-none",
          isActuallyCollapsed ? "lg:w-[78px]" : "lg:w-[252px]",
        )}
      >
        <div className="relative flex h-full w-full flex-col pb-4 pt-10">
          <div
            className="absolute left-0 top-0 h-8 w-full"
            data-window-drag-region
            style={{ WebkitAppRegion: "drag" } as CSSProperties}
          />
          <SidebarHeader
            collapsed={isActuallyCollapsed}
            isSettingsRoute={isSettingsRoute}
            isMobileOpen={!!isMobileOpen}
            onMobileClose={onMobileClose}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            t={t}
          />
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <SidebarNavigation collapsed={isActuallyCollapsed} pathname={pathname} groups={sidebarGroups} t={t} />
            <WorkspaceSection
              collapsed={isActuallyCollapsed}
              workspaceItems={workspaceItems}
              activeProjectPath={activeProjectPath}
              activeCheckoutPath={activeCheckoutPath}
              openingWorkspace={openingWorkspace}
              deletingWorkspacePath={null}
              expandedWorkspaces={expandedWorkspaces}
              worktreesByWorkspace={worktreesByWorkspace}
              gitWorkspacePaths={gitWorkspacePaths}
              loadingWorktreePaths={loadingWorktreePaths}
              worktreeSessionCounts={worktreeSessionCounts}
              onOpenFolderPicker={() => void openFolderPicker()}
              onOpenWorkspace={(path) => void openWorkspace(path)}
              onToggleWorkspaceExpand={toggleWorkspaceExpand}
              onSetWorktreeCreateTarget={setWorktreeCreateTarget}
              onWorkspaceContextMenu={handleWorkspaceContextMenu}
              onWorktreeSelect={(workspacePath, worktree) => {
                void openCheckout(workspacePath, worktree.worktree_path);
              }}
              onWorktreeDelete={setDeleteWorktreeTarget}
              t={t}
            />
          </div>
        </div>
      </aside>
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(path) => void openWorkspace(path)}
        initialPath={activeProjectPath || undefined}
      />
      {worktreeCreateTarget ? (
        <WorktreeCreateDialog
          open={Boolean(worktreeCreateTarget)}
          onOpenChange={(open) => {
            if (!open) setWorktreeCreateTarget(null);
          }}
          workspacePath={worktreeCreateTarget}
          currentCount={(worktreesByWorkspace[worktreeCreateTarget] || []).filter(
            (worktree) => worktree.is_managed && !worktree.is_default,
          ).length}
          maxCount={worktreeLimitsByWorkspace[worktreeCreateTarget] || 8}
          onCreated={(worktree) => {
            const projectPath = worktreeCreateTarget;
            setWorktreesByWorkspace((current) => ({
              ...current,
              [projectPath]: [
                ...(current[projectPath] || []).filter((entry) => entry.id !== worktree.id),
                worktree,
              ],
            }));
            setExpandedWorkspaces((current) => new Set(current).add(projectPath));
            setWorktreeCreateTarget(null);
            void refreshWorktrees(projectPath);
            void openCheckout(projectPath, worktree.worktree_path);
          }}
        />
      ) : null}
      <WorktreeDeleteDialog
        worktree={deleteWorktreeTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteWorktreeTarget(null);
        }}
        onDeleted={(worktree) => {
          setDeleteWorktreeTarget(null);
          setWorktreesByWorkspace((current) => ({
            ...current,
            [worktree.workspace_path]: (current[worktree.workspace_path] || []).filter(
              (entry) => entry.id !== worktree.id,
            ),
          }));
          void refreshWorktrees(worktree.workspace_path);
          if (normalizeWorkspacePath(activeCheckoutPath) === normalizeWorkspacePath(worktree.worktree_path)) {
            void openCheckout(worktree.workspace_path, worktree.workspace_path);
          }
        }}
      />
      <WorkspaceContextMenu
        contextMenuPosition={contextMenuPosition}
        contextMenuWorkspace={contextMenuWorkspace}
        onOpenInFinder={(workspacePath) => {
          void window.electronAPI?.shell?.openPath(workspacePath);
          setContextMenuPosition(null);
          setContextMenuWorkspace(null);
        }}
        isGitWorkspace={contextMenuWorkspace ? gitWorkspacePaths[contextMenuWorkspace.path] === true : false}
        onCreateWorktree={(workspacePath) => {
          setWorktreeCreateTarget(workspacePath);
          setContextMenuPosition(null);
          setContextMenuWorkspace(null);
        }}
        onCloseWorkspace={(workspace) => {
          removeWorkspace(workspace.path);
          if (activeProjectPath === workspace.path) {
            setWorkingDirectory("");
            router.push("/dashboard");
          }
          setContextMenuPosition(null);
          setContextMenuWorkspace(null);
        }}
        t={t}
      />
    </>
  );
}
