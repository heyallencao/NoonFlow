"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { NewSidebar } from "./NewSidebar";
import { RightPanel } from "./RightPanel";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { UpdateBanner } from "./UpdateBanner";
import { DocPreview } from "./DocPreview";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";
import { UpdateContext, type UpdateInfo } from "@/hooks/useUpdate";
import { ImageGenContext, useImageGenState } from "@/hooks/useImageGen";
import { BatchImageGenContext, useBatchImageGenState } from "@/hooks/useBatchImageGen";
import { SplitContext, type SplitSession } from "@/hooks/useSplit";
import { SplitChatContainer } from "./SplitChatContainer";
import { ErrorBoundary } from "./ErrorBoundary";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PanelRightOpenIcon, Menu01Icon, Sun01Icon, Moon01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import { useTheme } from "next-themes";
import { useRuntimeStore } from '@/stores/runtime-store';
import { isDangerouslySkipPermissionsEnabled } from "@/lib/assistant-permissions";
import { subscribeSessionRefresh } from '@/lib/events/session-refresh-hub';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  removeCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const SPLIT_SESSIONS_KEY = "noonflow:split-sessions";
const LEGACY_SPLIT_SESSIONS_KEYS = ["monolith:split-sessions"] as const;
const SPLIT_ACTIVE_COLUMN_KEY = "noonflow:split-active-column";
const LEGACY_SPLIT_ACTIVE_COLUMN_KEYS = ["monolith:split-active-column"] as const;
let volatileSplitSessions: SplitSession[] = [];
let volatileActiveColumnId = "";

function clearPersistedSplitState() {
  if (typeof window === "undefined") return;
  const storage = getLocalStorageSafe();
  removeCompatibleStorageValue(storage, SPLIT_SESSIONS_KEY, LEGACY_SPLIT_SESSIONS_KEYS);
  removeCompatibleStorageValue(storage, SPLIT_ACTIVE_COLUMN_KEY, LEGACY_SPLIT_ACTIVE_COLUMN_KEYS);
}

function loadSplitSessions(): SplitSession[] {
  clearPersistedSplitState();
  return volatileSplitSessions;
}

function saveSplitSessions(sessions: SplitSession[]) {
  volatileSplitSessions = sessions;
  clearPersistedSplitState();
}

function loadActiveColumn(): string {
  clearPersistedSplitState();
  return volatileActiveColumnId;
}

const EMPTY_SET = new Set<string>();
const RIGHTPANEL_MIN = 200;
const RIGHTPANEL_MAX = 480;
const DOCPREVIEW_MIN = 320;
const DOCPREVIEW_MAX = 800;
const RESPONSIVE_PANEL_MAX_RATIO = 0.65;

function defaultViewMode(): PreviewViewMode {
  return "source";
}

const LG_BREAKPOINT = 1024;
const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const DISMISSED_VERSION_KEY = "noonflow_dismissed_update_version";
const LEGACY_DISMISSED_VERSION_KEYS = ["monolith_dismissed_update_version"] as const;
const RIGHT_PANEL_WIDTH_KEY = "noonflow_rightpanel_width";
const LEGACY_RIGHT_PANEL_WIDTH_KEYS = ["monolith_rightpanel_width"] as const;
const DOC_PREVIEW_WIDTH_KEY = "noonflow_docpreview_width";
const LEGACY_DOC_PREVIEW_WIDTH_KEYS = ["monolith_docpreview_width"] as const;
const DEFAULT_THEME_TOGGLE_ICON = Moon01Icon;

function startDesktopWindowDrag() {
  if (typeof window === "undefined") return Promise.resolve();
  const nativeStartDragging = window.electronAPI?.window?.startDragging;
  if (!nativeStartDragging) {
    return Promise.resolve();
  }

  return nativeStartDragging();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const themeReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Sync mobile sidebar state: close when navigating or when screen size changes to desktop
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setIsMobileSidebarOpen(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const [, setChatListOpenRaw] = useState(false);

  const getResponsivePanelMax = useCallback((fallbackMax: number) => {
    if (typeof window === "undefined") {
      return fallbackMax;
    }
    return Math.max(fallbackMax, Math.floor(window.innerWidth * RESPONSIVE_PANEL_MAX_RATIO));
  }, []);

  const clampRightPanelWidth = useCallback((width: number) => {
    const max = getResponsivePanelMax(RIGHTPANEL_MAX);
    return Math.min(max, Math.max(RIGHTPANEL_MIN, width));
  }, [getResponsivePanelMax]);

  const clampDocPreviewWidth = useCallback((width: number) => {
    const max = getResponsivePanelMax(DOCPREVIEW_MAX);
    return Math.min(max, Math.max(DOCPREVIEW_MIN, width));
  }, [getResponsivePanelMax]);

  const [rightPanelWidth, setRightPanelWidth] = useState(288);

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => clampRightPanelWidth(w - delta));
  }, [clampRightPanelWidth]);
  const handleRightPanelResizeEnd = useCallback(() => {
    setRightPanelWidth((w) => {
      writeStorageValue(getLocalStorageSafe(), RIGHT_PANEL_WIDTH_KEY, String(w));
      return w;
    });
  }, []);

  // Panel state
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const isTerminalRoute = pathname.startsWith("/terminal/");
  const isSettingsRoute = pathname.startsWith("/settings");

  useEffect(() => {
    if (!isChatRoute) {
      setChatListOpenRaw(false);
    }
  }, [isChatRoute]);
  const [panelOpen, setPanelOpenRaw] = useState(false);
  const [panelContent, setPanelContent] = useState<PanelContent>("files");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  const runtimeSnapshots = useRuntimeStore((state) => state.snapshots);
  const activeStreamingSessions = useMemo(() => {
    const sessionIds = Object.values(runtimeSnapshots)
      .filter((snapshot) => snapshot.phase === 'active')
      .map((snapshot) => snapshot.sessionId);
    return sessionIds.length > 0 ? new Set(sessionIds) : EMPTY_SET;
  }, [runtimeSnapshots]);
  const pendingApprovalSessionIds = useMemo(() => {
    const sessionIds = Object.values(runtimeSnapshots)
      .filter((snapshot) => snapshot.pendingPermission && !snapshot.permissionResolved)
      .map((snapshot) => snapshot.sessionId);
    return sessionIds.length > 0 ? new Set(sessionIds) : EMPTY_SET;
  }, [runtimeSnapshots]);

  // --- Split-screen state ---
  const [layoutStateHydrated, setLayoutStateHydrated] = useState(false);
  const [splitSessions, setSplitSessions] = useState<SplitSession[]>([]);
  const [activeColumnId, setActiveColumnIdRaw] = useState<string>('');
  const isSplitActive = splitSessions.length >= 2;
  const isChatDetailRoute = pathname.startsWith("/chat/") || isTerminalRoute || isSplitActive;

  // Keep split-session routing state in memory only.
  useEffect(() => {
    if (!layoutStateHydrated) {
      return;
    }

    saveSplitSessions(splitSessions);
    if (activeColumnId) {
      volatileActiveColumnId = activeColumnId;
    }
  }, [layoutStateHydrated, splitSessions, activeColumnId]);

  // URL sync: when activeColumn changes, update router
  useEffect(() => {
    if (isSplitActive && activeColumnId) {
      const target = `/chat/${activeColumnId}`;
      if (pathname !== target) {
        router.replace(target);
      }
    }
  }, [isSplitActive, activeColumnId, pathname, router]);

  const setActiveColumn = useCallback((sessionId: string) => {
    setActiveColumnIdRaw(sessionId);
  }, []);

  const addToSplit = useCallback((session: SplitSession) => {
    setSplitSessions((prev) => {
      // If already in split, don't add again
      if (prev.some((s) => s.sessionId === session.sessionId)) return prev;

      if (prev.length < 2) {
        // First time entering split: add current active session + new session
        // The current session info comes from PanelContext
        const currentSessionId = sessionId;
        if (currentSessionId && currentSessionId !== session.sessionId) {
          const currentSession: SplitSession = {
            sessionId: currentSessionId,
            title: sessionTitle || "New Conversation",
            workingDirectory: workingDirectory || "",
            projectName: "",
            mode: "code",
          };
          // Check if current is already in the list
          const hasCurrentAlready = prev.some((s) => s.sessionId === currentSessionId);
          const next = hasCurrentAlready ? [...prev, session] : [...prev, currentSession, session];
          setActiveColumnIdRaw(session.sessionId);
          return next;
        }
      }

      // Append to existing split
      const next = [...prev, session];
      setActiveColumnIdRaw(session.sessionId);
      return next;
    });
  }, [sessionId, sessionTitle, workingDirectory]);

  const pendingNavigateRef = useRef<string | null>(null);
  const previousWorkingDirectoryRef = useRef<string | null>(null);

  const removeFromSplit = useCallback((removeId: string) => {
    setSplitSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== removeId);
      if (next.length <= 1) {
        // Exit split mode — defer navigation to useEffect
        if (next.length === 1) {
          pendingNavigateRef.current = next[0].sessionId;
        }
        return [];
      }
      // If removing active column, switch to first remaining
      setActiveColumnIdRaw((currentActive) =>
        currentActive === removeId ? next[0].sessionId : currentActive
      );
      return next;
    });
  }, []);

  // Deferred navigation after split exit (avoids setState-during-render)
  useEffect(() => {
    if (pendingNavigateRef.current) {
      const target = pendingNavigateRef.current;
      pendingNavigateRef.current = null;
      router.replace(`/chat/${target}`);
    }
  }, [splitSessions, router]);

  const exitSplit = useCallback(() => {
    const firstSession = splitSessions[0];
    setSplitSessions([]);
    setActiveColumnIdRaw("");
    if (firstSession) {
      router.replace(`/chat/${firstSession.sessionId}`);
    }
  }, [splitSessions, router]);

  const isInSplit = useCallback((sid: string) => {
    return splitSessions.some((s) => s.sessionId === sid);
  }, [splitSessions]);

  // Handle delete of a session that's in split
  useEffect(() => {
    return subscribeSessionRefresh((detail) => {
      if (detail.type !== 'deleted') {
        return;
      }

      const deletedIds = new Set(
        detail.sessionIds ?? (detail.sessionId ? [detail.sessionId] : []),
      );
      if (deletedIds.size === 0) {
        return;
      }

      setSplitSessions((prev) => {
        const next = prev.filter((session) => !deletedIds.has(session.sessionId));
        if (next.length === prev.length) {
          return prev;
        }

        if (next.length <= 1) {
          if (next.length === 1) {
            pendingNavigateRef.current = next[0].sessionId;
          }
          setActiveColumnIdRaw('');
          return [];
        }

        setActiveColumnIdRaw((currentActive) => (
          currentActive && deletedIds.has(currentActive) ? next[0].sessionId : currentActive
        ));
        return next;
      });
    });
  }, []);

  // Exit split when navigating to non-chat routes
  useEffect(() => {
    if (isSplitActive && !pathname.startsWith("/chat")) {
      setSplitSessions([]);
      setActiveColumnIdRaw("");
    }
  }, [isSplitActive, pathname]);

  const splitContextValue = useMemo(
    () => ({
      splitSessions,
      activeColumnId,
      isSplitActive,
      addToSplit,
      removeFromSplit,
      setActiveColumn,
      exitSplit,
      isInSplit,
    }),
    [splitSessions, activeColumnId, isSplitActive, addToSplit, removeFromSplit, setActiveColumn, exitSplit, isInSplit]
  );

  // Warn before closing window/tab while any session is streaming
  useEffect(() => {
    if (activeStreamingSessions.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeStreamingSessions]);

  // --- Doc Preview state ---
  const [previewFile, setPreviewFileRaw] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");
  const [docPreviewWidth, setDocPreviewWidth] = useState(480);

  const setPreviewFile = useCallback((path: string | null) => {
    setPreviewFileRaw(path);
    if (path) {
      setPreviewViewMode(defaultViewMode());
    }
  }, []);

  const handleDocPreviewResize = useCallback((delta: number) => {
    setDocPreviewWidth((w) => clampDocPreviewWidth(w - delta));
  }, [clampDocPreviewWidth]);
  const handleDocPreviewResizeEnd = useCallback(() => {
    setDocPreviewWidth((w) => {
      writeStorageValue(getLocalStorageSafe(), DOC_PREVIEW_WIDTH_KEY, String(w));
      return w;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storage = getLocalStorageSafe();
    const storedRightPanelWidth = parseInt(
      readCompatibleStorageValue(storage, RIGHT_PANEL_WIDTH_KEY, LEGACY_RIGHT_PANEL_WIDTH_KEYS) || '288',
      10,
    );
    const storedDocPreviewWidth = parseInt(
      readCompatibleStorageValue(storage, DOC_PREVIEW_WIDTH_KEY, LEGACY_DOC_PREVIEW_WIDTH_KEYS) || '480',
      10,
    );
    setRightPanelWidth(clampRightPanelWidth(storedRightPanelWidth));
    setDocPreviewWidth(clampDocPreviewWidth(storedDocPreviewWidth));
    setSplitSessions(loadSplitSessions());
    setActiveColumnIdRaw(loadActiveColumn());
    setLayoutStateHydrated(true);
  }, [clampDocPreviewWidth, clampRightPanelWidth]);

  useEffect(() => {
    const onResize = () => {
      setRightPanelWidth((width) => clampRightPanelWidth(width));
      setDocPreviewWidth((width) => clampDocPreviewWidth(width));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampDocPreviewWidth, clampRightPanelWidth]);

  // Auto-open panel on chat detail routes, close on others
  // Also close doc preview when navigating away or switching sessions
  useEffect(() => {
    setPanelOpenRaw(isChatDetailRoute);
    setPreviewFileRaw(null);
  }, [isChatDetailRoute, pathname]);

  useEffect(() => {
    if (previousWorkingDirectoryRef.current === null) {
      previousWorkingDirectoryRef.current = workingDirectory;
      return;
    }
    if (previousWorkingDirectoryRef.current === workingDirectory) {
      return;
    }
    previousWorkingDirectoryRef.current = workingDirectory;
    setPreviewFileRaw(null);
  }, [workingDirectory]);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenRaw(open);
  }, []);

  // Keep chat list state in sync when resizing across the breakpoint (only on chat routes)
  useEffect(() => {
    if (!isChatRoute) return;
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    setChatListOpenRaw(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [isChatRoute]);

  // --- Skip-permissions indicator ---
  const [, setSkipPermissionsActive] = useState(false);

  const fetchSkipPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        setSkipPermissionsActive(isDangerouslySkipPermissionsEnabled(data.settings?.dangerously_skip_permissions));
      }
    } catch {
      // ignore
    }
  }, []);

  // Re-fetch when window gains focus / becomes visible instead of polling every 5s
  useEffect(() => {
    fetchSkipPermissions();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchSkipPermissions();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", fetchSkipPermissions);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", fetchSkipPermissions);
    };
  }, [fetchSkipPermissions]);

  // --- Update check state ---
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  // Runtime detection: native updater is available only when the desktop bridge exposes updater APIs.
  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  // --- Native updater status listener ---
  useEffect(() => {
    if (!isNativeUpdater) return;
    const cleanup = window.electronAPI!.updater!.onStatus((event) => {
      switch (event.status) {
        case 'available':
          setUpdateInfo((prev) => ({
            updateAvailable: true,
            latestVersion: event.info?.version ?? prev?.latestVersion ?? '',
            currentVersion: prev?.currentVersion ?? '',
            releaseName: event.info?.releaseName ?? prev?.releaseName ?? '',
            releaseNotes: typeof event.info?.releaseNotes === 'string' ? event.info.releaseNotes : prev?.releaseNotes ?? '',
            releaseUrl: prev?.releaseUrl ?? '',
            publishedAt: event.info?.releaseDate ?? prev?.publishedAt ?? '',
            downloadProgress: null,
            readyToInstall: false,
            isNativeUpdate: true,
            lastError: null,
          }));
          {
            const ver = event.info?.version;
            const dismissed = readCompatibleStorageValue(
              getLocalStorageSafe(),
              DISMISSED_VERSION_KEY,
              LEGACY_DISMISSED_VERSION_KEYS,
            );
            if (ver && dismissed !== ver) {
              setShowDialog(true);
            }
          }
          break;
        case 'not-available':
          setUpdateInfo((prev) => prev ? { ...prev, updateAvailable: false, isNativeUpdate: true, lastError: null } : prev);
          break;
        case 'downloading':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? prev.downloadProgress,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'downloaded':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            readyToInstall: true,
            downloadProgress: 100,
            isNativeUpdate: true,
            lastError: null,
          } : prev);
          break;
        case 'error':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            lastError: event.error ?? 'Unknown error',
            isNativeUpdate: true,
          } : prev);
          break;
      }
      if (event.status === 'checking') {
        setChecking(true);
      } else {
        setChecking(false);
      }
    });
    return cleanup;
  }, [isNativeUpdater]);

  // --- Browser-mode update check (fallback when native updater is unavailable) ---
  const checkForUpdatesBrowser = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
        lastError: null,
      };
      setUpdateInfo(info);

      if (info.updateAvailable) {
        const dismissed = readCompatibleStorageValue(
          getLocalStorageSafe(),
          DISMISSED_VERSION_KEY,
          LEGACY_DISMISSED_VERSION_KEYS,
        );
        if (dismissed !== info.latestVersion) {
          setShowDialog(true);
        }
      }
    } catch {
      // silently ignore network errors
    } finally {
      setChecking(false);
    }
  }, []);

  // --- Unified check: native first, browser fallback ---
  const checkForUpdates = useCallback(async () => {
    if (isNativeUpdater) {
      try {
        await window.electronAPI!.updater!.checkForUpdates();
        return;
      } catch {
        // native check failed, fall through to browser mode
      }
    }
    await checkForUpdatesBrowser();
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  // Browser mode: periodic check when native updater is unavailable or failed
  useEffect(() => {
    if (isNativeUpdater) return; // native updater handles its own initial check
    checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    if (updateInfo?.latestVersion) {
      writeStorageValue(getLocalStorageSafe(), DISMISSED_VERSION_KEY, updateInfo.latestVersion);
    }
    setShowDialog(false);
  }, [updateInfo?.latestVersion]);

  const downloadUpdate = useCallback(async () => {
    if (isNativeUpdater) {
      await window.electronAPI!.updater!.downloadUpdate();
    }
  }, [isNativeUpdater]);

  const quitAndInstall = useCallback(() => {
    if (isNativeUpdater) {
      window.electronAPI!.updater!.quitAndInstall();
    }
  }, [isNativeUpdater]);

  const updateContextValue = useMemo(
    () => ({
      updateInfo,
      checking,
      checkForUpdates,
      downloadUpdate,
      dismissUpdate,
      showDialog,
      setShowDialog,
      quitAndInstall,
    }),
    [updateInfo, checking, checkForUpdates, downloadUpdate, dismissUpdate, showDialog, quitAndInstall]
  );

  const panelContextValue = useMemo(
    () => ({
      panelOpen,
      setPanelOpen,
      panelContent,
      setPanelContent,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      activeStreamingSessions,
      pendingApprovalSessionIds,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [panelOpen, setPanelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, activeStreamingSessions, pendingApprovalSessionIds, previewFile, setPreviewFile, previewViewMode]
  );

  const imageGenValue = useImageGenState();
  const batchImageGenValue = useBatchImageGenState();
  const handleTopDragMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    void startDesktopWindowDrag().catch(() => {});
  }, []);
  const topDragRightInset = useMemo(() => {
    if (!isChatDetailRoute) return 0;

    let inset = 0;
    if (previewFile) inset += docPreviewWidth;
    if (panelOpen) inset += rightPanelWidth;
    return inset;
  }, [docPreviewWidth, isChatDetailRoute, panelOpen, previewFile, rightPanelWidth]);

  return (
    <UpdateContext.Provider value={updateContextValue}>
      <PanelContext.Provider value={panelContextValue}>
        <SplitContext.Provider value={splitContextValue}>
        <ImageGenContext.Provider value={imageGenValue}>
        <BatchImageGenContext.Provider value={batchImageGenValue}>
        <TooltipProvider delayDuration={300}>
          <div className="h-screen h-dvh min-h-screen min-h-dvh w-full overflow-hidden bg-bg-primary">
            <div className="relative flex h-full overflow-hidden rounded-xl border border-transparent bg-background">
              <div
                className="absolute inset-x-0 top-0 z-50 h-8"
                data-window-drag-region
                style={{
                  WebkitAppRegion: "drag",
                  right: topDragRightInset > 0 ? `${topDragRightInset}px` : undefined,
                } as CSSProperties}
                onMouseDownCapture={handleTopDragMouseDown}
              />
              {!isSettingsRoute && (
                <NewSidebar
                  isMobileOpen={isMobileSidebarOpen}
                  onMobileClose={() => setIsMobileSidebarOpen(false)}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <UpdateBanner />
                {/* Mobile Header for Sidebar Toggle */}
                {!isSettingsRoute && (
                  <header className="flex h-12 shrink-0 items-center border-b border-border-subtle bg-bg-primary px-4 lg:hidden">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setIsMobileSidebarOpen(true)}
                      className="h-8 w-8 text-sidebar-foreground/80"
                    >
                      <HugeiconsIcon icon={Menu01Icon} className="h-5 w-5" />
                      <span className="sr-only">{t("nav.openSidebar")}</span>
                    </Button>
                    <div className="flex-1 ml-3 text-sm font-semibold text-sidebar-foreground/90">
                      NoonFlow
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      className="h-8 w-8 text-sidebar-foreground/80"
                    >
                      <HugeiconsIcon
                        icon={themeReady && theme === 'dark' ? Sun01Icon : DEFAULT_THEME_TOGGLE_ICON}
                        className="h-4.5 w-4.5"
                      />
                      <span className="sr-only">{t("nav.toggleTheme")}</span>
                    </Button>
                  </header>
                )}
                <main className="relative flex-1 overflow-hidden">
                  {isSplitActive ? (
                    <SplitChatContainer />
                  ) : (
                    <ErrorBoundary>{children}</ErrorBoundary>
                  )}
                </main>
              </div>
              {isSplitActive && isChatDetailRoute && !panelOpen && (
                <div className="pointer-events-none absolute right-4 top-14 z-30 hidden lg:block">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="pointer-events-auto border border-border-default bg-bg-tertiary text-sidebar-foreground/82 hover:bg-bg-hover hover:text-sidebar-foreground"
                        onClick={() => setPanelOpen(true)}
                      >
                        <HugeiconsIcon icon={PanelRightOpenIcon} className="h-4 w-4" />
                        <span className="sr-only">{t("panel.openPanel")}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{t("panel.openPanel")}</TooltipContent>
                  </Tooltip>
                </div>
              )}
              {isChatDetailRoute && previewFile && (
                <ResizeHandle
                  side="right"
                  label="doc-preview"
                  onResize={handleDocPreviewResize}
                  onResizeEnd={handleDocPreviewResizeEnd}
                />
              )}
              {isChatDetailRoute && previewFile && (
                <ErrorBoundary>
                  <DocPreview
                    filePath={previewFile}
                    viewMode={previewViewMode}
                    onViewModeChange={setPreviewViewMode}
                    onClose={() => setPreviewFile(null)}
                    width={docPreviewWidth}
                  />
                </ErrorBoundary>
              )}
              {isChatDetailRoute && panelOpen && (
                <div className="relative z-20">
                  <ResizeHandle
                    side="left"
                    label="right-panel"
                    onResize={handleRightPanelResize}
                    onResizeEnd={handleRightPanelResizeEnd}
                  />
                </div>
              )}
              {isChatDetailRoute && (
                <ErrorBoundary>
                  <RightPanel width={rightPanelWidth} />
                </ErrorBoundary>
              )}
            </div>
          </div>
          <UpdateDialog />
          <Toaster />
        </TooltipProvider>
        </BatchImageGenContext.Provider>
        </ImageGenContext.Provider>
        </SplitContext.Provider>
      </PanelContext.Provider>
    </UpdateContext.Provider>
  );
}
