"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { FilePlus, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { subscribeRefreshFileTree, publishInsertPathToChat } from '@/lib/events/app-event-bus';
import type { FileTreeNode } from "@/types";
import {
  FileTree as AIFileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import { useTranslation } from "@/hooks/useTranslation";
import {
  CONTEXT_MENU_WIDTH,
  DIRECTORY_EXPAND_SCAN_DEPTH,
  FILE_TREE_EVENT_DEBOUNCE_MS,
  ROOT_TREE_SCAN_DEPTH,
  type FileNodeType,
  filterTree,
  getFileIcon,
  getPathDepth,
  getRelativePath,
  hasDirectoryPath,
  mergeDirectoryNodes,
  replaceDirectoryChildren,
  validateNodeName,
} from "./file-tree/helpers";

type NameDialogMode = "create-file" | "create-folder" | "rename";

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileTreeNode;
}

interface NameDialogState {
  mode: NameDialogMode;
  parentPath?: string;
  node?: FileTreeNode;
}


export function FileTree({
  workingDirectory,
  onFileSelect,
  onFileAdd,
}: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileTreeNode | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTreeNode[]>([]);
  const expandedPathsRef = useRef<Set<string>>(new Set());
  const fetchInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const directoryFetchInFlightRef = useRef<Set<string>>(new Set());
  const loadedDirectoryPathsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);
  const { t } = useTranslation();

  const requestDirectoryTree = useCallback(
    async (targetDir: string, depth: number): Promise<FileTreeNode[] | null> => {
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(targetDir)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=${depth}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      return data.tree || [];
    },
    [workingDirectory]
  );

  const loadDirectoryChildren = useCallback(
    async (directoryPath: string, force: boolean = false) => {
      if (!workingDirectory || !directoryPath) return;
      if (!force && loadedDirectoryPathsRef.current.has(directoryPath)) return;
      if (directoryFetchInFlightRef.current.has(directoryPath)) return;
      if (!force && !hasDirectoryPath(treeRef.current, directoryPath)) return;

      directoryFetchInFlightRef.current.add(directoryPath);
      try {
        const nextChildren = await requestDirectoryTree(directoryPath, DIRECTORY_EXPAND_SCAN_DEPTH);
        if (!nextChildren) return;
        const nextTree = replaceDirectoryChildren(treeRef.current, directoryPath, nextChildren);
        treeRef.current = nextTree;
        setTree(nextTree);
        loadedDirectoryPathsRef.current.add(directoryPath);
      } catch {
        // ignore directory fetch errors to avoid blocking interaction
      } finally {
        directoryFetchInFlightRef.current.delete(directoryPath);
      }
    },
    [requestDirectoryTree, workingDirectory]
  );

  const fetchTreeOnce = useCallback(async () => {
    if (!workingDirectory) {
      treeRef.current = [];
      setTree([]);
      return;
    }

    setLoading(true);
    try {
      const nextRootTree = await requestDirectoryTree(workingDirectory, ROOT_TREE_SCAN_DEPTH);
      if (!nextRootTree) {
        treeRef.current = [];
        setTree([]);
        return;
      }

      const mergedRootTree = mergeDirectoryNodes(nextRootTree, treeRef.current);
      treeRef.current = mergedRootTree;
      setTree(mergedRootTree);
      setErrorMessage(null);

      loadedDirectoryPathsRef.current.clear();

      const expandedSnapshot = Array.from(expandedPathsRef.current).sort(
        (a, b) => getPathDepth(a) - getPathDepth(b)
      );
      for (const expandedPath of expandedSnapshot) {
        await loadDirectoryChildren(expandedPath, true);
      }
    } catch {
      treeRef.current = [];
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [loadDirectoryChildren, requestDirectoryTree, workingDirectory]);

  const fetchTree = useCallback(async () => {
    if (!workingDirectory) {
      setTree([]);
      return;
    }

    if (fetchInFlightRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    fetchInFlightRef.current = true;
    try {
      do {
        queuedRefreshRef.current = false;
        await fetchTreeOnce();
      } while (queuedRefreshRef.current);
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [fetchTreeOnce, workingDirectory]);

  const scheduleTreeRefresh = useCallback(
    (delayMs: number = FILE_TREE_EVENT_DEBOUNCE_MS) => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void fetchTree();
      }, delayMs);
    },
    [fetchTree]
  );


  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  useEffect(() => {
    setSelectedPath(undefined);
    setExpandedPaths(new Set());
    setContextMenu(null);
    setNameDialog(null);
    setDeleteTarget(null);
    loadedDirectoryPathsRef.current.clear();
    directoryFetchInFlightRef.current.clear();
  }, [workingDirectory]);


  useEffect(() => {
    const handler = () => scheduleTreeRefresh();
    const unsubscribe = subscribeRefreshFileTree(handler);
    return () => {
      unsubscribe();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [scheduleTreeRefresh]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    const closeMenu = () => setContextMenu(null);

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu]);

  const performFileOperation = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) => {
      const res = await fetch("/api/files/ops", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          baseDir: workingDirectory,
        }),
      });

      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error || t("fileTree.operationFailed"));
      }
    },
    [workingDirectory, t]
  );

  const createNode = useCallback(
    async (parentPath: string, nodeType: FileNodeType, rawName: string): Promise<boolean> => {
      const name = validateNodeName(rawName);
      if (!name) {
        setNameError(t("fileTree.nameInvalid"));
        return false;
      }

      setPendingPath(parentPath);
      try {
        await performFileOperation("POST", { parentPath, name, nodeType });
        void fetchTree();
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("fileTree.operationFailed"));
        return false;
      } finally {
        setPendingPath(null);
      }
    },
    [fetchTree, performFileOperation, t]
  );

  const renameNode = useCallback(
    async (node: FileTreeNode, rawName: string): Promise<boolean> => {
      const nextName = validateNodeName(rawName);
      if (!nextName) {
        setNameError(t("fileTree.nameInvalid"));
        return false;
      }

      setPendingPath(node.path);
      try {
        await performFileOperation("PATCH", { targetPath: node.path, newName: nextName });
        void fetchTree();
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("fileTree.operationFailed"));
        return false;
      } finally {
        setPendingPath(null);
      }
    },
    [fetchTree, performFileOperation, t]
  );

  const deleteNode = useCallback(
    async (node: FileTreeNode): Promise<boolean> => {
      setPendingPath(node.path);
      try {
        await performFileOperation("DELETE", { targetPath: node.path });
        void fetchTree();
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("fileTree.operationFailed"));
        return false;
      } finally {
        setPendingPath(null);
      }
    },
    [fetchTree, performFileOperation, t]
  );

  const handleCopyPath = useCallback(
    async (targetPath: string, relative: boolean) => {
      const value = relative ? getRelativePath(targetPath, workingDirectory) : targetPath;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        setErrorMessage(t("fileTree.operationFailed"));
      }
    },
    [workingDirectory, t]
  );

  const openContextMenu = useCallback((node: FileTreeNode, x: number, y: number) => {
    setSelectedPath(node.path);
    setContextMenu({ x, y, node });
  }, []);

  const openCreateDialog = useCallback((parentPath: string, nodeType: FileNodeType) => {
    setNameError(null);
    setNameValue("");
    setNameDialog({ mode: nodeType === "file" ? "create-file" : "create-folder", parentPath });
  }, []);

  const openRenameDialog = useCallback((node: FileTreeNode) => {
    setNameError(null);
    setNameValue(node.name);
    setNameDialog({ mode: "rename", node });
  }, []);

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: FileTreeNode) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(node, event.clientX, event.clientY);
    },
    [openContextMenu]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextAction = useCallback(
    (action: () => void) => {
      closeContextMenu();
      action();
    },
    [closeContextMenu]
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onFileSelect(path);
    },
    [onFileSelect]
  );

  const handleExpandedChange = useCallback(
    (nextExpanded: Set<string>) => {
      const openedPaths = Array.from(nextExpanded).filter(
        (expandedPath) => !expandedPathsRef.current.has(expandedPath)
      );

      const nextExpandedSet = new Set(nextExpanded);
      expandedPathsRef.current = nextExpandedSet;
      setExpandedPaths(nextExpandedSet);

      for (const openedPath of openedPaths) {
        void loadDirectoryChildren(openedPath);
      }
    },
    [loadDirectoryChildren]
  );

  const submitNameDialog = useCallback(() => {
    if (!nameDialog) return;

    const current = nameDialog;
    const nextValue = validateNodeName(nameValue);
    if (!nextValue) {
      setNameError(t("fileTree.nameInvalid"));
      return;
    }

    if (current.mode === "rename" && current.node && nextValue === current.node.name) {
      setNameDialog(null);
      setNameError(null);
      setNameValue("");
      return;
    }

    setNameDialog(null);
    setNameError(null);
    setNameValue("");

    if (current.mode === "create-file" && current.parentPath) {
      void createNode(current.parentPath, "file", nextValue);
      return;
    }
    if (current.mode === "create-folder" && current.parentPath) {
      void createNode(current.parentPath, "directory", nextValue);
      return;
    }
    if (current.mode === "rename" && current.node) {
      void renameNode(current.node, nextValue);
    }
  }, [createNode, nameDialog, nameValue, renameNode, t]);

  const renderTreeNodes = useCallback(
    (nodes: FileTreeNode[]): ReactNode =>
      nodes.map((node) => {
        if (node.type === "directory") {
          return (
            <FileTreeFolder
              key={node.path}
              path={node.path}
              name={node.name}
              data-file-node="true"
              data-node-path={node.path}
              onContextMenu={(event) => handleNodeContextMenu(event, node)}
              onMouseDown={(event) => {
                if (event.button === 2) {
                  event.preventDefault();
                  event.stopPropagation();
                  openContextMenu(node, event.clientX, event.clientY);
                }
              }}
            >
              {node.children ? renderTreeNodes(node.children) : null}
            </FileTreeFolder>
          );
        }
        return (
          <FileTreeFile
            key={node.path}
            path={node.path}
            name={node.name}
            icon={getFileIcon(node.extension)}
            data-file-node="true"
            data-node-path={node.path}
            onContextMenu={(event) => handleNodeContextMenu(event, node)}
            onMouseDown={(event) => {
              if (event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
                openContextMenu(node, event.clientX, event.clientY);
              }
            }}
          />
        );
      }),
    [handleNodeContextMenu, openContextMenu]
  );

  const contextMenuStyle = useMemo<CSSProperties>(() => {
    if (!contextMenu || typeof window === "undefined") return {};

    const totalItems = contextMenu.node.type === "directory" ? 7 : 5;
    const menuHeight = totalItems * 30 + 12;
    const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - CONTEXT_MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 8));

    return { left, top };
  }, [contextMenu]);

  const nameDialogTitle = useMemo(() => {
    if (!nameDialog) return "";
    if (nameDialog.mode === "create-file") return t("fileTree.newFile");
    if (nameDialog.mode === "create-folder") return t("fileTree.newFolder");
    return t("fileTree.rename");
  }, [nameDialog, t]);

  const nameDialogHint = useMemo(() => {
    if (!nameDialog) return "";
    if (nameDialog.mode === "create-file") return t("fileTree.enterFileName");
    if (nameDialog.mode === "create-folder") return t("fileTree.enterFolderName");
    return t("fileTree.enterNewName");
  }, [nameDialog, t]);

  const nameDialogActionLabel = useMemo(() => {
    if (!nameDialog) return "";
    if (nameDialog.mode === "rename") return t("fileTree.rename");
    if (nameDialog.mode === "create-file") return t("fileTree.newFile");
    return t("fileTree.newFolder");
  }, [nameDialog, t]);

  const filteredTree = searchQuery ? filterTree(tree, searchQuery) : tree;
  const actionDisabled = loading || pendingPath !== null || !workingDirectory;
  const handleRefreshAll = useCallback(() => {
    void fetchTree();
  }, [fetchTree]);


  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/50"
            />
            <Input
              placeholder={t("fileTree.filterFiles")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-full border border-transparent bg-foreground/5 pl-9 pr-3 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 transition-all focus:border-border-default focus:bg-background/50 hover:bg-foreground/10"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRefreshAll}
            disabled={loading}
            className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-foreground/5 hover:text-sidebar-foreground"
            title={t("fileTree.refresh")}
          >
            <HugeiconsIcon icon={RefreshIcon} className={cn("h-4 w-4", loading && "animate-spin")} />
            <span className="sr-only">{t("fileTree.refresh")}</span>
          </Button>
          <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-foreground/5 hover:text-sidebar-foreground"
                onClick={() => openCreateDialog(workingDirectory, "file")}
                disabled={actionDisabled}
                title={t("fileTree.newFile")}
              >
                <FilePlus className="h-4 w-4" />
                <span className="sr-only">{t("fileTree.newFile")}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 shrink-0 text-sidebar-foreground/70 hover:bg-foreground/5 hover:text-sidebar-foreground"
                onClick={() => openCreateDialog(workingDirectory, "directory")}
                disabled={actionDisabled}
                title={t("fileTree.newFolder")}
              >
                <FolderPlus className="h-4 w-4" />
                <span className="sr-only">{t("fileTree.newFolder")}</span>
              </Button>
        </div>

        {errorMessage && <p className="px-4 pb-2 text-xs text-destructive">{errorMessage}</p>}

          <div
            className="min-h-0 flex-1 overflow-auto overscroll-contain"
            onContextMenu={(event) => {
              const target = event.target as HTMLElement | null;
              if (!target?.closest('[data-file-node="true"]')) {
                setContextMenu(null);
              }
            }}
          >
            {loading && tree.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <HugeiconsIcon icon={RefreshIcon} className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTree.length === 0 ? (
              <p className="py-8 text-center text-xs text-sidebar-foreground/50">
                {workingDirectory ? t("fileTree.noFiles") : t("fileTree.selectFolder")}
              </p>
            ) : (
              <AIFileTree
                expanded={expandedPaths}
                selectedPath={selectedPath}
                onExpandedChange={handleExpandedChange}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI Elements FileTree onSelect type conflicts with HTMLAttributes.onSelect
                onSelect={handleFileSelect as any}
                onAdd={onFileAdd}
                className="min-w-max pl-2 pb-4 pr-4 text-sidebar-foreground"
              >
                {renderTreeNodes(filteredTree)}
              </AIFileTree>
            )}
          </div>

        {contextMenu && typeof document !== "undefined" &&
          createPortal(
            <div className="fixed inset-0 z-[1000]" onContextMenu={(event) => event.preventDefault()}>
              <div
                ref={contextMenuRef}
                className="absolute min-w-48 rounded-xl border border-border-default bg-background p-1.5 shadow-xl"
                style={contextMenuStyle}
              >
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => handleContextAction(() => publishInsertPathToChat({ path: contextMenu.node.path }))}
                >
                  {t("fileTree.addToChat")}
                </button>
                <div className="my-1.5 h-px bg-border-subtle" />
                {contextMenu.node.type === "directory" && (
                  <>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                      onClick={() => handleContextAction(() => openCreateDialog(contextMenu.node.path, "file"))}
                      disabled={pendingPath !== null}
                    >
                      {t("fileTree.newFile")}
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                      onClick={() =>
                        handleContextAction(() => openCreateDialog(contextMenu.node.path, "directory"))
                      }
                      disabled={pendingPath !== null}
                    >
                      {t("fileTree.newFolder")}
                    </button>
                    <div className="my-1.5 h-px bg-border-subtle" />
                  </>
                )}
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => handleContextAction(() => void handleCopyPath(contextMenu.node.path, false))}
                  disabled={pendingPath !== null}
                >
                  {t("fileTree.copyPath")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => handleContextAction(() => void handleCopyPath(contextMenu.node.path, true))}
                  disabled={pendingPath !== null}
                >
                  {t("fileTree.copyRelativePath")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-sidebar-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => handleContextAction(() => openRenameDialog(contextMenu.node))}
                  disabled={pendingPath !== null}
                >
                  {t("fileTree.rename")}
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() => handleContextAction(() => setDeleteTarget(contextMenu.node))}
                  disabled={pendingPath !== null}
                >
                  {t("fileTree.delete")}
                </button>
              </div>
            </div>,
            document.body
          )}
      </div>

      <Dialog
        open={!!nameDialog}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialog(null);
            setNameError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{nameDialogTitle}</DialogTitle>
            <DialogDescription>{nameDialogHint}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitNameDialog();
            }}
          >
            <Input
              autoFocus
              value={nameValue}
              onChange={(event) => {
                setNameValue(event.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder={nameDialogHint}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNameDialog(null);
                  setNameError(null);
                }}
                disabled={pendingPath !== null}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pendingPath !== null}>
                {nameDialogActionLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteTarget ? t("fileTree.confirmDelete", { name: deleteTarget.name }) : ""}
            </DialogTitle>
            <DialogDescription>{t("fileTree.deleteWarning")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pendingPath !== null}
              onClick={() => {
                setDeleteTarget(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingPath !== null || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) return;
                const target = deleteTarget;
                setDeleteTarget(null);
                void deleteNode(target);
              }}
            >
              {pendingPath !== null && deleteTarget
                ? t("common.loading")
                : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
