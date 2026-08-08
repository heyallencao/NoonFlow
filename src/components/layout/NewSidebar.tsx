"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
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
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { buildCreateSessionPreferencePayload } from "@/lib/chat-preferences";
import { publishSessionCreated } from "@/lib/events/session-refresh-hub";
import { fetchSessionsForOpenedWorkspaces, useSessionsQuery } from "@/lib/queries/session-queries";
import { cn, parseDBDate } from "@/lib/utils";
import { buildWorkspaceList, normalizeWorkspacePath } from "@/lib/workspace-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AssistantRuntime, ChatSession } from "@/types";
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
  const sessionsQuery = useSessionsQuery("all", storedWorkspaces);
  const sessions = useMemo<ChatSession[]>(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data?.sessions]);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrate);
  const rememberWorkspace = useWorkspaceStore((state) => state.rememberWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const setLastWorkspace = useWorkspaceStore((state) => state.setLastWorkspace);
  const [collapsed, setCollapsed] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState<string | null>(null);
  const [contextMenuWorkspace, setContextMenuWorkspace] = useState<WorkspaceItem | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const activeWorkspace = useMemo(
    () => normalizeWorkspacePath(workingDirectory || ""),
    [workingDirectory],
  );
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

  const openWorkspace = useCallback(async (workspacePath: string) => {
    const normalized = normalizeWorkspacePath(workspacePath);
    if (!normalized) return;

    setOpeningWorkspace(normalized);
    rememberWorkspace(normalized);
    setLastWorkspace(normalized);
    setWorkingDirectory(normalized);

    try {
      const latestSessions = await fetchSessionsForOpenedWorkspaces("all", [normalized])
        .then((result) => result.sessions)
        .catch(() => sessions);
      const latestNativeSession = latestSessions
        .filter((session) => (
          session.session_type === "chat"
          && normalizeWorkspacePath(session.working_directory || "") === normalized
        ))
        .sort((left, right) => parseDBDate(right.updated_at).getTime() - parseDBDate(left.updated_at).getTime())[0];

      if (latestNativeSession) {
        router.push(`/chat/${latestNativeSession.id}`);
      } else {
        await createSessionInWorkspace(normalized);
      }
      onMobileClose?.();
    } finally {
      setOpeningWorkspace(null);
    }
  }, [createSessionInWorkspace, onMobileClose, rememberWorkspace, router, sessions, setLastWorkspace, setWorkingDirectory]);

  const openFolderPicker = useCallback(async () => {
    if (hasNativeFolderDialog) {
      const selectedPath = await openNativePicker({
        defaultPath: activeWorkspace || undefined,
        title: t("folderPicker.title"),
      });
      if (selectedPath) await openWorkspace(selectedPath);
      return;
    }
    setFolderPickerOpen(true);
  }, [activeWorkspace, hasNativeFolderDialog, openNativePicker, openWorkspace, t]);

  const workspaceItems = useMemo<WorkspaceItem[]>(
    () => buildWorkspaceList({ workspaces: storedWorkspaces, hiddenWorkspaces, sessions }),
    [hiddenWorkspaces, sessions, storedWorkspaces],
  );

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
              activeWorkspace={activeWorkspace}
              openingWorkspace={openingWorkspace}
              deletingWorkspacePath={null}
              onOpenFolderPicker={() => void openFolderPicker()}
              onOpenWorkspace={(path) => void openWorkspace(path)}
              onWorkspaceContextMenu={handleWorkspaceContextMenu}
              t={t}
            />
          </div>
        </div>
      </aside>
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(path) => void openWorkspace(path)}
        initialPath={activeWorkspace || undefined}
      />
      <WorkspaceContextMenu
        contextMenuPosition={contextMenuPosition}
        contextMenuWorkspace={contextMenuWorkspace}
        onOpenInFinder={(workspacePath) => {
          void window.electronAPI?.shell?.openPath(workspacePath);
          setContextMenuPosition(null);
          setContextMenuWorkspace(null);
        }}
        onCloseWorkspace={(workspace) => {
          removeWorkspace(workspace.path);
          if (activeWorkspace === workspace.path) {
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
