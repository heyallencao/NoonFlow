"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PanelRightOpenIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { useAssistantRuntimesQuery } from "@/lib/queries/assistant-runtime-queries";
import { useRuntimeStore } from "@/stores/runtime-store";
import {
  publishSessionCreated,
  publishSessionDeleted,
  publishSessionUpdated,
  subscribeSessionRefresh,
  type SessionRefreshDetail,
} from "@/lib/events/session-refresh-hub";
import { publishSessionTabClosed } from '@/lib/events/app-event-bus';
import { isImeComposingEvent } from "@/lib/ime";
import { normalizeWorkspacePath } from "@/lib/workspace-utils";
import type { ChatSession } from "@/types";
import { cn } from "@/lib/utils";
import {
  resolveSessionTabExecutionStatus,
  type SessionTabRuntimeState,
  type TabExecutionStatus,
} from "@/lib/session-tab-status";
import {
  getSessionMetaCacheSnapshot,
  upsertSessionMetaCacheEntries,
  upsertSessionMetaCacheEntry,
  removeSessionMetaCacheEntry,
} from "@/lib/session-client-cache";
import { buildCreateSessionPreferencePayload } from '@/lib/chat-preferences';
import { sanitizeOpenTabIds } from '@/lib/open-tabs';
import { clearTerminalPanelMemory } from '@/lib/terminal-panel-memory';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  removeCompatibleStorageValue,
} from '@/lib/browser-storage';
import { toast } from "sonner";
import type { AssistantRuntime } from "@/types";

interface SessionTabsProps {
  activeSessionId: string;
  activeSessionTitle?: string;
  workingDirectory: string;
  activeSessionType?: "chat" | "terminal";
}

interface SessionTabItem {
  id: string;
  title: string;
  sessionType: "chat";
  assistantRuntime?: AssistantRuntime | "";
}

interface SessionTabContextMenuState {
  tabId: string;
  title: string;
  sessionType: "chat";
  x: number;
  y: number;
}

const CONTEXT_MENU_WIDTH = 168;

const TAB_STATUS_DOT_CLASSNAME: Record<TabExecutionStatus, string> = {
  running: 'bg-amber-400 animate-pulse',
  waiting: 'bg-yellow-500 animate-pulse',
  error: 'bg-red-500',
  ready: 'bg-emerald-500',
  unknown: 'bg-muted-foreground/35',
};

const TAB_STATUS_LABEL: Record<TabExecutionStatus, string> = {
  running: 'Running',
  waiting: 'Awaiting approval',
  error: 'Error',
  ready: 'Ready',
  unknown: 'Unknown',
};

function RuntimeGlyph({ runtime, className }: { runtime?: AssistantRuntime | ""; className?: string }) {
  if (runtime === 'codex') {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.35" />
        <path d="M5.4 6L7.15 8L5.4 10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.7 10H10.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    );
  }

  if (runtime === 'claude_code') {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="1.15" fill="currentColor" />
        <path d="M8 2.5V5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M8 11V13.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M2.5 8H5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M11 8H13.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M4.12 4.12L5.9 5.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M10.1 10.1L11.88 11.88" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M11.88 4.12L10.1 5.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M5.9 10.1L4.12 11.88" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    );
  }

  if (runtime === 'pi') {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 12V4.5h4.1a2.5 2.5 0 0 1 0 5H4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.2 6.4V12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <circle cx="11.2" cy="4.2" r=".8" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.1 6.2L8 8L10.9 6.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.1 9.8H10.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function getRuntimeLabel(runtime?: AssistantRuntime | ""): string {
  if (runtime === 'codex') return 'Codex';
  if (runtime === 'claude_code') return 'Claude Code';
  if (runtime === 'pi') return 'Pi';
  return 'Unknown Runtime';
}

function isMacLikePlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform =
    ("userAgentData" in navigator
      ? (
          navigator as Navigator & {
            userAgentData?: { platform?: string };
          }
        ).userAgentData?.platform
      : undefined) ??
    navigator.platform ??
    "";

  return /mac|iphone|ipad|ipod/i.test(platform);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const editableElement = target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  );
  if (!editableElement) {
    return false;
  }

  return !(editableElement as HTMLElement).hasAttribute("disabled");
}

function resolveTabIndexFromShortcut(event: KeyboardEvent): number | null {
  if (event.key >= "1" && event.key <= "9") {
    return Number(event.key) - 1;
  }

  if (event.code.startsWith("Digit") || event.code.startsWith("Numpad")) {
    const digit = event.code.slice(-1);
    if (digit >= "1" && digit <= "9") {
      return Number(digit) - 1;
    }
  }

  return null;
}

function getSessionHref(sessionId: string) {
  return `/chat/${sessionId}`;
}

function openTabsStorageKey(workspace: string) {
  return `noonflow:open-tabs:${workspace}`;
}

function legacyOpenTabsStorageKeys(workspace: string) {
  return [`monolith:open-tabs:${workspace}`];
}

const volatileOpenTabs = new Map<string, string[]>();
const volatileTabsScroll = new Map<string, number>();

const OPEN_TABS_UPDATED_EVENT = "noonflow:open-tabs-updated";

function publishOpenTabsUpdated(workspace: string, tabIds: string[]) {
  if (typeof window === "undefined" || !workspace) return;
  window.dispatchEvent(
    new CustomEvent(OPEN_TABS_UPDATED_EVENT, {
      detail: { workspace, tabIds },
    })
  );
}

function tabsScrollStorageKey(workspace: string) {
  return `noonflow:tabs-scroll:${workspace}`;
}

function legacyTabsScrollStorageKeys(workspace: string) {
  return [`monolith:tabs-scroll:${workspace}`];
}

function terminalPanelStorageKey(workspace: string) {
  return `noonflow:terminal-panel:${workspace}`;
}

function legacyTerminalPanelStorageKeys(workspace: string) {
  return [`monolith:terminal-panel:${workspace}`];
}

function readOpenTabIds(workspace: string): string[] {
  if (typeof window === "undefined" || !workspace) return [];
  removeCompatibleStorageValue(
    getLocalStorageSafe(),
    openTabsStorageKey(workspace),
    legacyOpenTabsStorageKeys(workspace),
  );
  return volatileOpenTabs.get(workspace) ?? [];
}

function writeOpenTabIds(workspace: string, tabIds: string[]) {
  if (typeof window === "undefined" || !workspace) return;
  const deduped = sanitizeOpenTabIds(tabIds);
  volatileOpenTabs.set(workspace, deduped);
  publishOpenTabsUpdated(workspace, deduped);
}

function readTabsScrollLeft(workspace: string): number {
  if (typeof window === "undefined" || !workspace) return 0;
  removeCompatibleStorageValue(
    getLocalStorageSafe(),
    tabsScrollStorageKey(workspace),
    legacyTabsScrollStorageKeys(workspace),
  );
  return volatileTabsScroll.get(workspace) ?? 0;
}

function writeTabsScrollLeft(workspace: string, value: number) {
  if (typeof window === "undefined" || !workspace) return;
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  volatileTabsScroll.set(workspace, normalized);
}

function closeWorkspaceTerminalPanel(workspace: string) {
  if (typeof window === "undefined" || !workspace) return;

  const storage = getLocalStorageSafe();
  const storageKey = terminalPanelStorageKey(workspace);
  let terminalSessionId = clearTerminalPanelMemory(workspace) || "";
  try {
    const raw = readCompatibleStorageValue(
      storage,
      storageKey,
      legacyTerminalPanelStorageKeys(workspace),
    );
    if (raw) {
      const parsed = JSON.parse(raw) as { sessionId?: unknown };
      if (!terminalSessionId && typeof parsed?.sessionId === "string" && parsed.sessionId) {
        terminalSessionId = parsed.sessionId;
      }
    }
  } catch {
    // Best effort.
  }

  removeCompatibleStorageValue(storage, storageKey, legacyTerminalPanelStorageKeys(workspace));
  if (terminalSessionId) {
    void window.electronAPI?.terminal?.close({ sessionId: terminalSessionId }).catch(() => {});
  }
}

function eventTouchesWorkspace(
  detail: SessionRefreshDetail,
  workspace: string,
  workspaceSessionIds: Set<string>,
  sessionMetaCache: Record<string, ReturnType<typeof getSessionMetaCacheSnapshot>[string]>,
): boolean {
  if (!workspace) {
    return true;
  }

  if (detail.workingDirectory) {
    return normalizeWorkspacePath(detail.workingDirectory) === workspace;
  }

  const eventIds = detail.sessionIds ?? (detail.sessionId ? [detail.sessionId] : []);
  if (eventIds.length === 0) {
    return detail.type === 'refetch';
  }

  return eventIds.some((sessionId) => {
    if (workspaceSessionIds.has(sessionId)) {
      return true;
    }
    const cachedWorkspace = normalizeWorkspacePath(sessionMetaCache[sessionId]?.workingDirectory || "");
    return cachedWorkspace === workspace;
  });
}

export function SessionTabs({
  activeSessionId,
  activeSessionTitle,
  workingDirectory,
  activeSessionType = "chat",
}: SessionTabsProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { panelOpen, setPanelOpen, activeStreamingSessions, pendingApprovalSessionIds } = usePanel();
  const assistantRuntimesQuery = useAssistantRuntimesQuery();
  const runtimeSnapshots = useRuntimeStore((state) => state.snapshots);
  const [creating, setCreating] = useState(false);
  const [workspaceSessions, setWorkspaceSessions] = useState<ChatSession[]>([]);
  const [sessionMetaCache, setSessionMetaCache] = useState<Record<string, ReturnType<typeof getSessionMetaCacheSnapshot>[string]>>({});
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [openTabsWorkspace, setOpenTabsWorkspace] = useState("");
  const [contextMenu, setContextMenu] = useState<SessionTabContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [renameTabId, setRenameTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const tabElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasRestoredTabsScrollRef = useRef(false);
  const hasPendingTabsScrollRestoreRef = useRef(false);

  const cachedActiveMeta = sessionMetaCache[activeSessionId];
  const effectiveWorkingDirectory = workingDirectory || cachedActiveMeta?.workingDirectory || "";
  const effectiveActiveSessionTitle = activeSessionTitle || cachedActiveMeta?.title;
  const effectiveActiveSessionType = activeSessionType || cachedActiveMeta?.sessionType || "chat";

  const normalizedWorkspace = useMemo(
    () => normalizeWorkspacePath(effectiveWorkingDirectory),
    [effectiveWorkingDirectory]
  );
  const assistantRuntimeById = useMemo(
    () => new Map((assistantRuntimesQuery.data?.runtimes || []).map((runtime) => [runtime.id, runtime])),
    [assistantRuntimesQuery.data?.runtimes]
  );
  const claudeRuntime = assistantRuntimeById.get('claude_code');
  const codexRuntime = assistantRuntimeById.get('codex');
  const piRuntime = assistantRuntimeById.get('pi');
  const showClaudeCreateButton = claudeRuntime ? claudeRuntime.enabled : true;
  const showCodexCreateButton = codexRuntime ? codexRuntime.enabled : true;
  const showPiCreateButton = piRuntime ? piRuntime.enabled : true;
  const canCreateClaudeSession = Boolean(normalizedWorkspace) && !creating && (claudeRuntime ? claudeRuntime.available : true);
  const canCreateCodexSession = Boolean(normalizedWorkspace) && !creating && (codexRuntime ? codexRuntime.available : true);
  const canCreatePiSession = Boolean(normalizedWorkspace) && !creating && (piRuntime ? piRuntime.available || piRuntime.launchable : true);
  const claudeTooltip = !normalizedWorkspace
    ? t("sessionTabs.selectWorkspaceFirst")
    : (!claudeRuntime?.available && claudeRuntime?.status_message)
      ? claudeRuntime.status_message
      : "New Claude chat";
  const codexTooltip = !normalizedWorkspace
    ? t("sessionTabs.selectWorkspaceFirst")
    : (!codexRuntime?.available && codexRuntime?.status_message)
      ? codexRuntime.status_message
      : "New Codex chat";
  const piTooltip = !normalizedWorkspace
    ? t("sessionTabs.selectWorkspaceFirst")
    : (!piRuntime?.launchable && piRuntime?.status_message)
      ? piRuntime.status_message
      : "New Pi chat";
  const sessionRuntimeById = useMemo(() => {
    const runtimeMap = new Map<string, SessionTabRuntimeState>();
    for (const session of workspaceSessions) {
      runtimeMap.set(session.id, {
        status: session.runtime_status || '',
        error: session.runtime_error || '',
      });
    }
    return runtimeMap;
  }, [workspaceSessions]);
  const sessionAssistantRuntimeById = useMemo(() => {
    const runtimeMap = new Map<string, AssistantRuntime | "">();
    for (const session of workspaceSessions) {
      runtimeMap.set(session.id, session.assistant_runtime || '');
    }
    return runtimeMap;
  }, [workspaceSessions]);

  const resolveTabExecutionStatus = useCallback((tabId: string): TabExecutionStatus => (
    resolveSessionTabExecutionStatus({
      snapshot: runtimeSnapshots[tabId],
      hasPendingApproval: pendingApprovalSessionIds.has(tabId),
      hasActiveStream: activeStreamingSessions.has(tabId),
      runtime: sessionRuntimeById.get(tabId),
    })
  ), [runtimeSnapshots, activeStreamingSessions, pendingApprovalSessionIds, sessionRuntimeById]);

  const persistTabsScroll = useCallback(() => {
    if (!normalizedWorkspace) return;
    const tabScrollContainer = tabsScrollRef.current;
    if (!tabScrollContainer) return;
    writeTabsScrollLeft(normalizedWorkspace, tabScrollContainer.scrollLeft);
  }, [normalizedWorkspace]);

  useEffect(() => {
    setSessionMetaCache(getSessionMetaCacheSnapshot());
  }, []);

  useEffect(() => {
    if (!activeSessionId || !effectiveWorkingDirectory) return;
    setSessionMetaCache(
      upsertSessionMetaCacheEntry({
        sessionId: activeSessionId,
        title: effectiveActiveSessionTitle || '',
        workingDirectory: effectiveWorkingDirectory,
        sessionType: effectiveActiveSessionType,
      })
    );
  }, [activeSessionId, effectiveActiveSessionTitle, effectiveActiveSessionType, effectiveWorkingDirectory]);

  useEffect(() => {
    if (!normalizedWorkspace) {
      setOpenTabsWorkspace("");
      setOpenTabIds(activeSessionId && effectiveActiveSessionType === "chat" ? [activeSessionId] : []);
      return;
    }

    const activeSessionMeta = activeSessionId ? sessionMetaCache[activeSessionId] : undefined;
    const activeSessionWorkspaceFromMeta = normalizeWorkspacePath(activeSessionMeta?.workingDirectory || "");
    const activeSessionType =
      workspaceSessions.find((session) => session.id === activeSessionId)?.session_type
      || activeSessionMeta?.sessionType
      || effectiveActiveSessionType
      || "chat";
    const activeSessionIsChat = activeSessionType === "chat";
    const activeSessionInNormalizedWorkspace = activeSessionWorkspaceFromMeta
      ? activeSessionWorkspaceFromMeta === normalizedWorkspace
      : workspaceSessions.some((session) => session.id === activeSessionId);

    const stored = readOpenTabIds(normalizedWorkspace);
    // 只在当前 active tab 不在 stored 中时才添加，保持原有顺序
    const needsActiveTab = activeSessionId && activeSessionInNormalizedWorkspace && activeSessionIsChat && !stored.includes(activeSessionId);
    const merged = needsActiveTab ? [...stored, activeSessionId] : stored;
    const activeFallback =
      activeSessionId && activeSessionInNormalizedWorkspace && activeSessionIsChat ? [activeSessionId] : [];
    setOpenTabsWorkspace(normalizedWorkspace);
    setOpenTabIds(merged.length > 0 ? merged : activeFallback);
  }, [normalizedWorkspace, activeSessionId, effectiveActiveSessionType, sessionMetaCache, workspaceSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    const workspaceSessionTypeById = new Map<string, "chat" | "terminal">(
      workspaceSessions.map((session) => [session.id, session.session_type || "chat"] as const)
    );
    const activeSessionMeta = sessionMetaCache[activeSessionId];
    const activeSessionWorkspaceFromMeta = normalizeWorkspacePath(activeSessionMeta?.workingDirectory || "");
    const activeSessionType =
      workspaceSessionTypeById.get(activeSessionId)
      || activeSessionMeta?.sessionType
      || effectiveActiveSessionType
      || "chat";
    const activeSessionIsChat = activeSessionType === "chat";
    const activeSessionInNormalizedWorkspace = activeSessionWorkspaceFromMeta
      ? activeSessionWorkspaceFromMeta === normalizedWorkspace
      : workspaceSessionTypeById.has(activeSessionId);

    const sanitized = Array.from(new Set(openTabIds)).filter((id) => {
      if (id === activeSessionId) return activeSessionIsChat;
      const sessionType = workspaceSessionTypeById.get(id);
      if (sessionType) {
        return sessionType === "chat";
      }

      // Keep unknown ids until the server list catches up; otherwise freshly-created tabs
      // can be dropped during the brief fetch gap.
      const cachedMeta = sessionMetaCache[id];
      if (cachedMeta) {
        if (normalizeWorkspacePath(cachedMeta.workingDirectory) !== normalizedWorkspace) {
          return false;
        }
        return (cachedMeta.sessionType || "chat") === "chat";
      }

      return true;
    });

    const next = sanitized.length > 0
      ? sanitized
      : activeSessionInNormalizedWorkspace && activeSessionId && activeSessionIsChat
      ? [activeSessionId]
      : [];
    if (next.length === openTabIds.length && next.every((id, index) => id === openTabIds[index])) {
      return;
    }
    setOpenTabIds(next);
  }, [activeSessionId, effectiveActiveSessionType, normalizedWorkspace, openTabIds, sessionMetaCache, workspaceSessions]);

  useEffect(() => {
    if (!normalizedWorkspace || openTabsWorkspace !== normalizedWorkspace) {
      return;
    }
    writeOpenTabIds(normalizedWorkspace, openTabIds);
  }, [normalizedWorkspace, openTabIds, openTabsWorkspace]);

  const fetchWorkspaceSessions = useCallback(async () => {
    if (!normalizedWorkspace) {
      setWorkspaceSessions([]);
      return;
    }

    try {
      const res = await fetch(
        `/api/chat/sessions?type=all&workspace=${encodeURIComponent(normalizedWorkspace)}`
      );
      if (!res.ok) return;

      const data = await res.json();
      const sessions: ChatSession[] = data.sessions || [];
      setWorkspaceSessions(sessions);
      setSessionMetaCache(
        upsertSessionMetaCacheEntries(
          sessions.map((session) => ({
            sessionId: session.id,
            title: session.title || t("chat.newConversation"),
            workingDirectory: session.working_directory || '',
            sessionType: session.session_type || 'chat',
          }))
        )
      );
    } catch {
      // Best effort
    }
  }, [normalizedWorkspace, t]);

  useEffect(() => {
    fetchWorkspaceSessions();
  }, [fetchWorkspaceSessions]);

  useEffect(() => {
    return subscribeSessionRefresh((detail) => {
      const workspaceSessionIds = new Set(workspaceSessions.map((session) => session.id));
      const touchesCurrentWorkspace = eventTouchesWorkspace(
        detail,
        normalizedWorkspace,
        workspaceSessionIds,
        sessionMetaCache,
      );

      if (detail.type === 'deleted') {
        const deletedIds = detail.sessionIds ?? (detail.sessionId ? [detail.sessionId] : []);
        if (deletedIds.length > 0) {
          const deletedSet = new Set(deletedIds);
          setOpenTabIds((prev) => prev.filter((id) => !deletedSet.has(id)));
          for (const id of deletedIds) {
            removeSessionMetaCacheEntry(id);
          }
          setSessionMetaCache(getSessionMetaCacheSnapshot());
        }
        if (!touchesCurrentWorkspace) {
          return;
        }
        void fetchWorkspaceSessions();
        return;
      }

      if (!touchesCurrentWorkspace) {
        return;
      }

      if (detail.type === 'updated') {
        const hasStructuralUpdate = Boolean(
          detail.title || detail.workingDirectory || detail.sessionType,
        );
        if (!hasStructuralUpdate) {
          return;
        }
      }

      if (detail.type === 'created' && detail.sessionType && detail.sessionType !== 'chat') {
        return;
      }

      void fetchWorkspaceSessions();
    });
  }, [fetchWorkspaceSessions, normalizedWorkspace, sessionMetaCache, workspaceSessions]);

  const visibleTabs = useMemo<SessionTabItem[]>(() => {
    if (!activeSessionId) return [];

    const titleMap = new Map<string, string>();
    const typeMap = new Map<string, "chat" | "terminal">();
    const runtimeMap = new Map<string, AssistantRuntime | "">();
    for (const session of workspaceSessions) {
      titleMap.set(session.id, session.title || t("chat.newConversation"));
      typeMap.set(session.id, session.session_type || "chat");
      runtimeMap.set(session.id, session.assistant_runtime || '');
    }

    for (const [sessionId, meta] of Object.entries(sessionMetaCache)) {
      if (!titleMap.has(sessionId) && meta.title) {
        titleMap.set(sessionId, meta.title);
      }
      if (!typeMap.has(sessionId) && meta.sessionType) {
        typeMap.set(sessionId, meta.sessionType);
      }
    }

    if (effectiveActiveSessionTitle && !titleMap.has(activeSessionId)) {
      titleMap.set(activeSessionId, effectiveActiveSessionTitle);
      typeMap.set(activeSessionId, effectiveActiveSessionType);
    }

    const activeSessionType = typeMap.get(activeSessionId) || effectiveActiveSessionType || "chat";
    const ids = openTabIds.length > 0 ? openTabIds : activeSessionType === "chat" ? [activeSessionId] : [];
    const items: SessionTabItem[] = [];
    for (const id of ids) {
      const title = titleMap.get(id);
      if (!title && id !== activeSessionId) continue;
      const sessionType = typeMap.get(id) || "chat";
      if (sessionType !== "chat") continue;
      items.push({
        id,
        title: title || effectiveActiveSessionTitle || t("chat.newConversation"),
        sessionType: "chat",
        assistantRuntime: runtimeMap.get(id) || '',
      });
    }

    if (activeSessionType === "chat" && !items.some((item) => item.id === activeSessionId)) {
      items.push({
        id: activeSessionId,
        title: effectiveActiveSessionTitle || t("chat.newConversation"),
        sessionType: "chat",
        assistantRuntime: runtimeMap.get(activeSessionId) || '',
      });
    }

    return items;
  }, [activeSessionId, effectiveActiveSessionTitle, effectiveActiveSessionType, openTabIds, sessionMetaCache, workspaceSessions, t]);

  const renameTarget = useMemo(() => {
    if (!renameTabId) return null;
    return visibleTabs.find((tab) => tab.id === renameTabId) ?? null;
  }, [renameTabId, visibleTabs]);

  const contextTabIndex = useMemo(() => {
    if (!contextMenu) return -1;
    return visibleTabs.findIndex((tab) => tab.id === contextMenu.tabId);
  }, [contextMenu, visibleTabs]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.shiftKey || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const isMac = isMacLikePlatform();
      const isShortcutPressed = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!isShortcutPressed) {
        return;
      }

      const tabIndex = resolveTabIndexFromShortcut(event);
      if (tabIndex === null) {
        return;
      }

      const targetTab = visibleTabs[tabIndex];
      if (!targetTab || targetTab.id === activeSessionId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setContextMenu(null);
      router.push(getSessionHref(targetTab.id));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeSessionId, router, visibleTabs]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    hasRestoredTabsScrollRef.current = false;
    hasPendingTabsScrollRestoreRef.current =
      normalizedWorkspace ? readTabsScrollLeft(normalizedWorkspace) > 0 : false;
  }, [normalizedWorkspace]);

  useEffect(() => {
    if (!normalizedWorkspace) {
      hasRestoredTabsScrollRef.current = true;
      hasPendingTabsScrollRestoreRef.current = false;
      return;
    }
    if (hasRestoredTabsScrollRef.current) return;
    if (visibleTabs.length === 0) return;

    const tabScrollContainer = tabsScrollRef.current;
    if (!tabScrollContainer) return;

    const savedScrollLeft = readTabsScrollLeft(normalizedWorkspace);
    if (savedScrollLeft <= 0) {
      hasRestoredTabsScrollRef.current = true;
      hasPendingTabsScrollRestoreRef.current = false;
      return;
    }

    const canScrollHorizontally =
      tabScrollContainer.scrollWidth > tabScrollContainer.clientWidth + 1;
    if (!canScrollHorizontally) {
      return;
    }

    tabScrollContainer.scrollLeft = savedScrollLeft;
    hasRestoredTabsScrollRef.current = true;
    hasPendingTabsScrollRestoreRef.current = false;
  }, [normalizedWorkspace, visibleTabs.length]);

  useEffect(() => {
    const activeIds = new Set(visibleTabs.map((tab) => tab.id));
    for (const tabId of Object.keys(tabElementRefs.current)) {
      if (!activeIds.has(tabId)) {
        delete tabElementRefs.current[tabId];
      }
    }
  }, [visibleTabs]);

  useEffect(() => {
    const activeTabElement = tabElementRefs.current[activeSessionId];
    const tabScrollContainer = tabsScrollRef.current;
    if (!activeTabElement || !tabScrollContainer) return;
    if (hasPendingTabsScrollRestoreRef.current && !hasRestoredTabsScrollRef.current) return;

    requestAnimationFrame(() => {
      const containerRect = tabScrollContainer.getBoundingClientRect();
      const tabRect = activeTabElement.getBoundingClientRect();

      const leftDelta = tabRect.left - containerRect.left;
      const rightDelta = tabRect.right - containerRect.right;
      const threshold = 6;
      const edgePadding = 10;

      if (leftDelta < -threshold) {
        tabScrollContainer.scrollBy({
          left: leftDelta - edgePadding,
          behavior: "auto",
        });
        persistTabsScroll();
        return;
      }

      if (rightDelta > threshold) {
        tabScrollContainer.scrollBy({
          left: rightDelta + edgePadding,
          behavior: "auto",
        });
        persistTabsScroll();
      }
    });
  }, [activeSessionId, visibleTabs.length, persistTabsScroll]);

  const handleCreateSession = useCallback(async (explicitRuntime?: AssistantRuntime) => {
    if (!normalizedWorkspace || creating) return;
    setCreating(true);
    try {
      const sessionPreferences = buildCreateSessionPreferencePayload(explicitRuntime);

      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          working_directory: normalizedWorkspace,
          ...sessionPreferences,
          session_type: "chat",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null) as { error?: string } | null;
        toast.error(errData?.error || "Failed to create session");
        return;
      }

      const data = await res.json();
      const sessionId: string = data.session?.id;
      if (!sessionId) return;

      setOpenTabIds((prev) => Array.from(new Set([...prev, sessionId])));

      setSessionMetaCache(
        upsertSessionMetaCacheEntry({
          sessionId,
          title: data.session?.title || t("chat.newConversation"),
          sessionType: "chat",
          workingDirectory: normalizedWorkspace,
        })
      );
      publishSessionCreated({
        sessionId,
        title: data.session?.title,
        sessionType: "chat",
        workingDirectory: normalizedWorkspace,
      });
      router.push(`/chat/${sessionId}`);
    } finally {
      setCreating(false);
    }
  }, [normalizedWorkspace, creating, router, t]);

  // Shortcut for creating new sessions: Cmd/Ctrl+Shift+N for Claude, Cmd/Ctrl+Shift+M for Codex
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const isMac = isMacLikePlatform();
      const isShortcutPressed = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;

      // Require Shift key for session creation shortcuts
      if (!isShortcutPressed || !event.shiftKey) {
        return;
      }

      // Cmd/Ctrl+Shift+N: Create Claude session
      if (event.key === 'N') {
        if (!showClaudeCreateButton || !canCreateClaudeSession) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void handleCreateSession('claude_code');
        return;
      }

      // Cmd/Ctrl+Shift+M: Create Codex session
      if (event.key === 'M') {
        if (!showCodexCreateButton || !canCreateCodexSession) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void handleCreateSession('codex');
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canCreateClaudeSession, canCreateCodexSession, handleCreateSession, showClaudeCreateButton, showCodexCreateButton]);

  const cleanupClosedTab = useCallback((
    tab: SessionTabItem | undefined,
    currentIds: string[],
  ) => {
    if (!tab) return;
    publishSessionTabClosed({ sessionId: tab.id, sessionType: "chat" });

    // Chat tabs: close means delete session from database (no archive/replay entry point in current UX)
    fetch(`/api/chat/sessions/${tab.id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to delete session");
        }
        setSessionMetaCache(removeSessionMetaCacheEntry(tab.id));
        publishSessionDeleted({
          sessionId: tab.id,
          sessionIds: [tab.id],
          sessionType: "chat",
        });
      })
      .catch(() => {
        setOpenTabIds((prev) => {
          if (prev.includes(tab.id)) {
            return prev;
          }

          const prevSet = new Set(prev);
          const restored = currentIds.filter((id) => id === tab.id || prevSet.has(id));
          const extras = prev.filter((id) => !currentIds.includes(id));
          return [...restored, ...extras];
        });
        toast.error(t("chat.clearError"));
      });
  }, [t]);

  const closeTabsByIds = useCallback(
    (tabIds: string[], preferredFallbackId?: string) => {
      if (tabIds.length === 0) return;

      const closingSet = new Set(tabIds);
      const currentTabs = visibleTabs;
      const currentIds = currentTabs.map((tab) => tab.id);
      const nextIds = currentIds.filter((id) => !closingSet.has(id));

      for (const tab of currentTabs) {
        if (closingSet.has(tab.id)) {
          cleanupClosedTab(tab, currentIds);
        }
      }

      setOpenTabIds(nextIds);

      if (nextIds.length === 0 && normalizedWorkspace) {
        closeWorkspaceTerminalPanel(normalizedWorkspace);
      }

      if (!closingSet.has(activeSessionId)) return;

      const fallbackId =
        (preferredFallbackId && nextIds.includes(preferredFallbackId)
          ? preferredFallbackId
          : undefined) ?? nextIds[nextIds.length - 1];

      if (fallbackId) {
        router.push(getSessionHref(fallbackId));
      } else {
        router.push("/chat");
      }
    },
    [activeSessionId, cleanupClosedTab, normalizedWorkspace, router, visibleTabs]
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const currentIds = visibleTabs.map((tab) => tab.id);
      const currentIndex = currentIds.indexOf(tabId);
      const nextIds = currentIds.filter((id) => id !== tabId);
      const preferredFallbackId =
        (currentIndex >= 0 ? nextIds[currentIndex] : undefined) ??
        (currentIndex > 0 ? nextIds[currentIndex - 1] : undefined) ??
        nextIds[nextIds.length - 1];

      closeTabsByIds([tabId], preferredFallbackId);
    },
    [closeTabsByIds, visibleTabs]
  );

  const handleCloseTabsToLeft = useCallback(() => {
    if (!contextMenu) return;
    if (contextTabIndex <= 0) return;
    const tabIds = visibleTabs.slice(0, contextTabIndex).map((tab) => tab.id);
    closeTabsByIds(tabIds, contextMenu.tabId);
    setContextMenu(null);
  }, [closeTabsByIds, contextMenu, contextTabIndex, visibleTabs]);

  const handleCloseTabsToRight = useCallback(() => {
    if (!contextMenu) return;
    if (contextTabIndex < 0 || contextTabIndex >= visibleTabs.length - 1) return;
    const tabIds = visibleTabs.slice(contextTabIndex + 1).map((tab) => tab.id);
    closeTabsByIds(tabIds, contextMenu.tabId);
    setContextMenu(null);
  }, [closeTabsByIds, contextMenu, contextTabIndex, visibleTabs]);

  const handleCloseOtherTabs = useCallback(() => {
    if (!contextMenu) return;
    const tabIds = visibleTabs
      .filter((tab) => tab.id !== contextMenu.tabId)
      .map((tab) => tab.id);
    if (tabIds.length === 0) return;
    closeTabsByIds(tabIds, contextMenu.tabId);
    setContextMenu(null);
  }, [closeTabsByIds, contextMenu, visibleTabs]);

  const handleCloseAllTabs = useCallback(() => {
    const tabIds = visibleTabs.map((tab) => tab.id);
    if (tabIds.length === 0) return;
    closeTabsByIds(tabIds);
    setContextMenu(null);
  }, [closeTabsByIds, visibleTabs]);

  const openRenameDialog = useCallback((tab: SessionTabItem) => {
    setContextMenu(null);
    setRenameTabId(tab.id);
    setRenameValue(tab.title);
    setRenameError(null);
  }, []);

  const closeRenameDialog = useCallback(() => {
    if (renameSaving) return;
    setRenameTabId(null);
    setRenameValue("");
    setRenameError(null);
  }, [renameSaving]);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || renameSaving) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      setRenameError(t("sessionTabs.renameEmpty"));
      return;
    }

    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/chat/sessions/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || t("sessionTabs.renameFailed"));
      }

      setWorkspaceSessions((prev) =>
        prev.map((session) =>
          session.id === renameTarget.id ? { ...session, title: nextTitle } : session
        )
      );
      setSessionMetaCache(
        upsertSessionMetaCacheEntry({
          sessionId: renameTarget.id,
          title: nextTitle,
          sessionType: renameTarget.sessionType,
          workingDirectory: normalizedWorkspace,
        })
      );
      publishSessionUpdated({
        sessionId: renameTarget.id,
        title: nextTitle,
        sessionType: renameTarget.sessionType,
        workingDirectory: normalizedWorkspace,
      });
      setRenameTabId(null);
      setRenameValue("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t("sessionTabs.renameFailed"));
    } finally {
      setRenameSaving(false);
    }
  }, [renameTarget, renameSaving, renameValue, t, normalizedWorkspace]);

  const contextMenuStyle = useMemo<CSSProperties>(() => {
    if (!contextMenu || typeof window === "undefined") return {};
    const menuHeight = 228;
    const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8));
    return { left, top };
  }, [contextMenu]);

  return (
    <>
      <div
        className={cn(
          "flex min-h-[56px] shrink-0 items-center gap-3 px-4 py-2",
          !panelOpen && "pr-12 lg:pr-14"
        )}
        data-window-drag-region
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        <div
          ref={tabsScrollRef}
          className="no-scrollbar relative z-50 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          onScroll={persistTabsScroll}
        >
          {visibleTabs.length > 0 ? (
            visibleTabs.map((tab) => {
              const isActive = tab.id === activeSessionId;
              const tabStatus = resolveTabExecutionStatus(tab.id);
              const tabStatusLabel = TAB_STATUS_LABEL[tabStatus];
              const tabRuntime = tab.assistantRuntime || sessionAssistantRuntimeById.get(tab.id) || '';
              const tabRuntimeLabel = getRuntimeLabel(tabRuntime);
              return (
                <div
                  key={tab.id}
                  ref={(node) => {
                    tabElementRefs.current[tab.id] = node;
                  }}
                  className={cn(
                    "group relative flex min-w-[116px] max-w-[220px] shrink-0 items-center rounded-full px-1 py-1 text-sm font-medium transition-all duration-300 border border-transparent cursor-pointer",
                    isActive
                      ? "bg-foreground/10 text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  )}
                  onClick={() => router.push(getSessionHref(tab.id))}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({
                      tabId: tab.id,
                      title: tab.title,
                      sessionType: tab.sessionType,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <div
                    className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-[13px] pointer-events-none"
                    title={`${tab.title} · ${tabRuntimeLabel} · ${tabStatusLabel}`}
                  >
                    <span
                      className={cn("inline-flex h-1.5 w-1.5 shrink-0 rounded-full", TAB_STATUS_DOT_CLASSNAME[tabStatus])}
                      aria-label={tabStatusLabel}
                    />
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 shrink-0 items-center justify-center transition-colors",
                        isActive ? "text-foreground/95" : "text-foreground/75 group-hover:text-foreground/95"
                      )}
                      aria-label={tabRuntimeLabel}
                    >
                      <RuntimeGlyph runtime={tabRuntime} className="h-3 w-3" />
                    </span>
                    <span className="block truncate tracking-tight">{tab.title}</span>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground z-10",
                      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    aria-label={t("sessionTabs.closeTab")}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          ) : (
            <span className="text-[13px] text-muted-foreground/60 px-2 font-medium">
              {t("sessionTabs.selectWorkspaceFirst")}
            </span>
          )}
        </div>

        <div
          className="relative z-50 flex shrink-0 items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {showClaudeCreateButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="h-7 w-7 rounded-full border-blue-500/30 bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 hover:text-blue-300"
                    disabled={!canCreateClaudeSession}
                    onClick={() => {
                      void handleCreateSession('claude_code');
                    }}
                    aria-label="New Claude chat"
                  >
                    <RuntimeGlyph runtime="claude_code" className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{claudeTooltip}</TooltipContent>
            </Tooltip>
          )}
          {showCodexCreateButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="h-7 w-7 rounded-full border-emerald-400/20 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/14 hover:text-emerald-200"
                    disabled={!canCreateCodexSession}
                    onClick={() => {
                      void handleCreateSession('codex');
                    }}
                    aria-label="New Codex chat"
                  >
                    <RuntimeGlyph runtime="codex" className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{codexTooltip}</TooltipContent>
            </Tooltip>
          )}
          {showPiCreateButton && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="h-7 w-7 rounded-full border-violet-400/20 bg-violet-500/8 text-violet-300 hover:bg-violet-500/14 hover:text-violet-200"
                    disabled={!canCreatePiSession}
                    onClick={() => {
                      void handleCreateSession('pi');
                    }}
                    aria-label="New Pi chat"
                  >
                    <RuntimeGlyph runtime="pi" className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{piTooltip}</TooltipContent>
            </Tooltip>
          )}
          {!panelOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 rounded-full border border-border-default bg-bg-tertiary text-sidebar-foreground/82 hover:bg-bg-hover hover:text-sidebar-foreground"
                  onClick={() => setPanelOpen(true)}
                >
                  <HugeiconsIcon icon={PanelRightOpenIcon} className="h-4 w-4" />
                  <span className="sr-only">{t("panel.openPanel")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("panel.openPanel")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {contextMenu && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000]" onContextMenu={(event) => event.preventDefault()}>
            <div
              ref={contextMenuRef}
              className="absolute min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={contextMenuStyle}
            >
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground"
                onClick={() =>
                  openRenameDialog({
                    id: contextMenu.tabId,
                    title: contextMenu.title,
                    sessionType: contextMenu.sessionType,
                  })
                }
              >
                {t("sessionTabs.rename")}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground"
                onClick={() => {
                  setContextMenu(null);
                  handleCloseTab(contextMenu.tabId);
                }}
              >
                {t("sessionTabs.closeTab")}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                onClick={handleCloseOtherTabs}
                disabled={visibleTabs.length <= 1}
              >
                {t("sessionTabs.closeOtherTabs")}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                onClick={handleCloseTabsToRight}
                disabled={contextTabIndex < 0 || contextTabIndex >= visibleTabs.length - 1}
              >
                {t("sessionTabs.closeTabsToRight")}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                onClick={handleCloseTabsToLeft}
                disabled={contextTabIndex <= 0}
              >
                {t("sessionTabs.closeTabsToLeft")}
              </button>
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06] hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                onClick={handleCloseAllTabs}
                disabled={visibleTabs.length === 0}
              >
                {t("sessionTabs.closeAllTabs")}
              </button>
            </div>
          </div>,
          document.body
        )}

      <Dialog open={!!renameTarget} onOpenChange={(open) => {
        if (!open) closeRenameDialog();
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("sessionTabs.renameDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(event) => {
                setRenameValue(event.target.value);
                if (renameError) setRenameError(null);
              }}
              placeholder={t("sessionTabs.renamePlaceholder")}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (isImeComposingEvent(event)) {
                    return;
                  }
                  event.preventDefault();
                  void handleRenameSubmit();
                }
              }}
              autoFocus
            />
            {renameError && <p className="text-xs text-destructive">{renameError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog} disabled={renameSaving}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleRenameSubmit();
              }}
              disabled={renameSaving}
            >
              {renameSaving ? t("sessionTabs.renaming") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
