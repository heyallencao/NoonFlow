"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Copy01Icon,
  Tick01Icon,
  Loading02Icon,
  FloppyDiskIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import {
  DOC_PREVIEW_EDIT_MAX_BYTES,
  getDocPreviewMode,
  isEditableDocPreviewMode,
  type DocPreviewMode,
} from "@/lib/doc-preview-mode";
import { publishRefreshFileTree } from "@/lib/events/app-event-bus";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import {
  STREAMDOWN_PLUGINS,
  mergeStreamdownRemarkPlugins,
} from "@/lib/streamdown-plugins";
import { STREAMDOWN_SHIKI_THEME } from "@/lib/streamdown-theme";
import { STREAMDOWN_LINK_SAFETY } from "@/components/ai-elements/streamdown-link-safety";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CodeMirrorSourceEditor,
  type CodeMirrorSourceEditorHandle,
} from "@/components/layout/CodeMirrorSourceEditor";
import { Streamdown } from "streamdown";
import { formatFileSize, type FilePreview as FilePreviewPayload } from "@/types";

type ViewMode = "source" | "rendered";

interface DocPreviewProps {
  filePath: string;
  diffFilePath?: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onClose: () => void;
  width: number;
}

interface DocFileState {
  mode: DocPreviewMode;
  size: number;
  lineCount: number;
  lineCountExact: boolean;
  truncated: boolean;
  binary: boolean;
}

interface RawEditError {
  error?: string;
  code?: string;
}

interface GitFileDiffResponse {
  file: string;
  stagedPatch: string;
  unstagedPatch: string;
  untrackedPatch: string;
}

const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cc: "cpp",
  cxx: "cpp",
  cpp: "cpp",
  h: "c",
  hh: "cpp",
  hxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  dockerfile: "docker",
  graphql: "graphql",
  gql: "graphql",
  vue: "markup",
  svelte: "markup",
  prisma: "prisma",
  env: "bash",
  lua: "lua",
  r: "r",
  php: "php",
  dart: "dart",
  zig: "zig",
  txt: "text",
};

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function getLanguageFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() || "";
  if (fileName === "dockerfile") return "docker";
  if (fileName === "makefile") return "makefile";
  if (fileName === "cmakelists.txt") return "cmake";

  const ext = getExtension(filePath).slice(1);
  return LANGUAGE_MAP[ext] || "text";
}

function isRenderable(filePath: string): boolean {
  return RENDERABLE_EXTENSIONS.has(getExtension(filePath));
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

function getLineCount(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFileReference(fileReference: string): { path: string; line: number | null } {
  const normalizedReference = decodeSafe(fileReference.trim());
  const hashMatch = normalizedReference.match(/^(.*?)(?:#L?(\d+)(?:C\d+)?)?$/i);
  if (hashMatch) {
    const parsedLine = hashMatch[2] ? Number.parseInt(hashMatch[2], 10) : NaN;
    if (Number.isFinite(parsedLine)) {
      return {
        path: hashMatch[1] || normalizedReference,
        line: parsedLine,
      };
    }
  }

  // Also support common "path:line[:column]" format.
  const colonMatch = normalizedReference.match(/^(.*):(\d+)(?::\d+)?$/);
  if (colonMatch) {
    const parsedLine = Number.parseInt(colonMatch[2], 10);
    if (Number.isFinite(parsedLine)) {
      return {
        path: colonMatch[1] || normalizedReference,
        line: parsedLine,
      };
    }
  }

  return { path: normalizedReference, line: null };
}

function countSubstringMatches(text: string, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  let count = 0;
  let offset = 0;
  while (offset <= normalizedText.length - normalizedQuery.length) {
    const index = normalizedText.indexOf(normalizedQuery, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + normalizedQuery.length;
  }
  return count;
}

export function DocPreview({
  filePath,
  diffFilePath,
  viewMode,
  onViewModeChange,
  onClose,
  width,
}: DocPreviewProps) {
  const { resolvedTheme } = useTheme();
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const isDark = resolvedTheme === "dark";
  const previewRootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeMirrorSourceEditorHandle>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [content, setContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [contentVersion, setContentVersion] = useState(0);
  const [renderedContent, setRenderedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileState, setFileState] = useState<DocFileState | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffError, setGitDiffError] = useState<string | null>(null);
  const [gitDiffData, setGitDiffData] = useState<GitFileDiffResponse | null>(null);
  const [isFileSearchVisible, setIsFileSearchVisible] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchMatchCount, setFileSearchMatchCount] = useState(0);
  const [activeFileSearchMatch, setActiveFileSearchMatch] = useState(0);

  const fileReference = useMemo(() => parseFileReference(filePath), [filePath]);
  const diffFileReference = useMemo(
    () => (diffFilePath ? parseFileReference(diffFilePath) : null),
    [diffFilePath]
  );
  const isDiffPreview = Boolean(diffFilePath);
  const activePreviewPath = diffFileReference?.path || fileReference.path;

  const language = useMemo(() => getLanguageFromPath(activePreviewPath), [activePreviewPath]);
  const canRender = useMemo(() => isRenderable(activePreviewPath), [activePreviewPath]);
  const canEdit = useMemo(
    () => (fileState ? !fileState.binary && isEditableDocPreviewMode(fileState.mode) : false),
    [fileState]
  );
  const canUseRenderedView = useMemo(
    () => Boolean(fileState && !fileState.binary && fileState.mode === "highlight" && canRender),
    [canRender, fileState]
  );
  const isDirty = canEdit && draftContent !== content;
  const canSearchInSource = !isDiffPreview && !loading && !error && viewMode === "source" && !fileState?.binary;

  const getCurrentDocumentText = useCallback(() => {
    if (fileState?.binary) {
      return "";
    }

    return editorRef.current?.getValue() ?? draftContent;
  }, [draftContent, fileState?.binary]);

  useEffect(() => {
    if (viewMode === "rendered" && !canUseRenderedView) {
      onViewModeChange("source");
    }
  }, [canUseRenderedView, onViewModeChange, viewMode]);

  useEffect(() => {
    let cancelled = false;
    const targetDiffFile = diffFileReference?.path;
    if (!isDiffPreview || !targetDiffFile || !workingDirectory) {
      setGitDiffData(null);
      setGitDiffError(null);
      setGitDiffLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const diffFilePath = targetDiffFile;
    const cwd = workingDirectory;

    async function loadGitDiff() {
      setGitDiffLoading(true);
      setGitDiffError(null);
      setGitDiffData(null);
      try {
        const res = await fetch(
          `/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(diffFilePath)}`,
          { cache: "no-store" }
        );
        const data = (await res.json().catch(() => null)) as (GitFileDiffResponse & { error?: string }) | null;
        if (!res.ok || !data) {
          throw new Error(data?.error || t("fileTree.diffLoadFailed"));
        }
        if (!cancelled) {
          setGitDiffData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setGitDiffError(err instanceof Error ? err.message : t("fileTree.diffLoadFailed"));
        }
      } finally {
        if (!cancelled) {
          setGitDiffLoading(false);
        }
      }
    }

    void loadGitDiff();
    return () => {
      cancelled = true;
    };
  }, [diffFileReference?.path, isDiffPreview, t, workingDirectory]);

  useEffect(() => {
    let cancelled = false;
    if (isDiffPreview) {
      setLoading(false);
      setError(null);
      setSaveError(null);
      setFileState(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadFallbackPreview(baseParams: URLSearchParams) {
      const previewRes = await fetch(`/api/files/preview?${baseParams.toString()}`);
      if (!previewRes.ok) {
        const previewError = (await previewRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(previewError?.error || t("filePreview.failedToLoad"));
      }

      const previewData = (await previewRes.json()) as { preview: FilePreviewPayload };
      const preview = previewData.preview;

      return {
        content: preview.content,
        state: {
          mode: preview.binary ? "readonly" : getDocPreviewMode(preview.size),
          size: preview.size,
          lineCount: preview.line_count,
          lineCountExact: preview.line_count_exact,
          truncated: preview.truncated,
          binary: preview.binary,
        } satisfies DocFileState,
      };
    }

    async function loadFile() {
      setLoading(true);
      setError(null);
      setSaveError(null);
      setCopied(false);
      setFileState(null);

      const baseParams = new URLSearchParams({ path: fileReference.path });
      if (workingDirectory) {
        baseParams.set("baseDir", workingDirectory);
      }

      try {
        const editableParams = new URLSearchParams(baseParams);
        editableParams.set("mode", "edit");

        const res = await fetch(`/api/files/raw?${editableParams.toString()}`);
        if (res.ok) {
          const text = await res.text();
          const size = Number(res.headers.get("X-File-Size") || new TextEncoder().encode(text).length);
          if (!cancelled) {
            setContent(text);
            setDraftContent(text);
            setRenderedContent(text);
            setContentVersion((current) => current + 1);
            setFileState({
              mode: getDocPreviewMode(size),
              size,
              lineCount: getLineCount(text),
              lineCountExact: true,
              truncated: false,
              binary: false,
            });
          }
          return;
        }

        const loadError = (await res.json().catch(() => null)) as RawEditError | null;
        if (res.status !== 413 && res.status !== 415) {
          throw new Error(loadError?.error || t("filePreview.failedToLoad"));
        }

        const fallback = await loadFallbackPreview(baseParams);
        if (!cancelled) {
          setContent(fallback.content);
          setDraftContent(fallback.content);
          setRenderedContent(fallback.content);
          setContentVersion((current) => current + 1);
          setFileState(fallback.state);
        }
      } catch (err) {
        if (!cancelled) {
          setContent("");
          setDraftContent("");
          setRenderedContent("");
          setContentVersion((current) => current + 1);
          setFileState(null);
          setError(err instanceof Error ? err.message : t("filePreview.failedToLoad"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [fileReference.path, isDiffPreview, t, workingDirectory]);

  useEffect(() => {
    const targetLine = fileReference.line;
    if (
      loading
      || error
      || isDiffPreview
      || viewMode !== "source"
      || fileState?.binary
      || !targetLine
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      editorRef.current?.scrollToLine(targetLine);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [contentVersion, error, fileReference.line, fileState?.binary, isDiffPreview, loading, viewMode]);

  const openFileSearch = useCallback(() => {
    if (!canSearchInSource) {
      return;
    }
    setIsFileSearchVisible(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [canSearchInSource]);

  const closeFileSearch = useCallback((focusEditor: boolean = true) => {
    setIsFileSearchVisible(false);
    setFileSearchQuery("");
    setFileSearchMatchCount(0);
    setActiveFileSearchMatch(0);
    editorRef.current?.clearSearchQuery();
    if (focusEditor) {
      window.requestAnimationFrame(() => {
        editorRef.current?.focus();
      });
    }
  }, []);

  const applyFileSearchQuery = useCallback((query: string, jumpToFirstMatch: boolean) => {
    setFileSearchQuery(query);
    const normalizedQuery = query.trim();
    editorRef.current?.setSearchQuery(normalizedQuery, {
      jumpToFirstMatch: jumpToFirstMatch && normalizedQuery.length > 0,
    });
    if (!normalizedQuery) {
      setFileSearchMatchCount(0);
      setActiveFileSearchMatch(0);
      return;
    }
    const totalMatches = countSubstringMatches(getCurrentDocumentText(), normalizedQuery);
    setFileSearchMatchCount(totalMatches);
    setActiveFileSearchMatch(totalMatches > 0 ? 1 : 0);
  }, [getCurrentDocumentText]);

  const navigateFileSearch = useCallback((direction: 1 | -1) => {
    if (!canSearchInSource || !fileSearchQuery.trim() || fileSearchMatchCount <= 0) {
      return;
    }

    if (direction === 1) {
      editorRef.current?.findNextMatch();
    } else {
      editorRef.current?.findPreviousMatch();
    }

    setActiveFileSearchMatch((current) => {
      if (fileSearchMatchCount <= 0) {
        return 0;
      }
      if (current <= 0) {
        return direction === 1 ? 1 : fileSearchMatchCount;
      }
      const next = current + direction;
      if (next < 1) {
        return fileSearchMatchCount;
      }
      if (next > fileSearchMatchCount) {
        return 1;
      }
      return next;
    });
  }, [canSearchInSource, fileSearchMatchCount, fileSearchQuery]);

  useEffect(() => {
    if (!canSearchInSource || !isFileSearchVisible) {
      return;
    }
    const normalizedQuery = fileSearchQuery.trim();
    if (!normalizedQuery) {
      return;
    }
    const totalMatches = countSubstringMatches(getCurrentDocumentText(), normalizedQuery);
    setFileSearchMatchCount(totalMatches);
    setActiveFileSearchMatch((current) => {
      if (totalMatches <= 0) {
        return 0;
      }
      if (current < 1) {
        return 1;
      }
      return Math.min(current, totalMatches);
    });
  }, [canSearchInSource, draftContent, fileSearchQuery, getCurrentDocumentText, isFileSearchVisible]);

  useEffect(() => {
    closeFileSearch(false);
  }, [activePreviewPath, closeFileSearch, isDiffPreview, viewMode]);

  useEffect(() => {
    const isTargetInsidePreview = (target: EventTarget | null): boolean => {
      const root = previewRootRef.current;
      if (!root || !(target instanceof Node)) {
        return false;
      }
      return root.contains(target);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const isFindShortcut = (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey
        && (event.key === "f" || event.key === "F");
      if (!isFindShortcut) {
        return;
      }
      if (!isTargetInsidePreview(event.target) && !isTargetInsidePreview(document.activeElement)) {
        return;
      }
      if (!canSearchInSource) {
        return;
      }
      event.preventDefault();
      openFileSearch();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSearchInSource, openFileSearch]);

  const handleViewModeChange = useCallback(
    (nextMode: ViewMode) => {
      if (nextMode === "rendered") {
        setRenderedContent(getCurrentDocumentText());
      }
      onViewModeChange(nextMode);
    },
    [getCurrentDocumentText, onViewModeChange]
  );

  const handleCopyContent = useCallback(async () => {
    const patchText = [gitDiffData?.stagedPatch, gitDiffData?.unstagedPatch, gitDiffData?.untrackedPatch]
      .filter((block) => Boolean(block?.trim()))
      .join("\n\n");
    const text = isDiffPreview ? (patchText || activePreviewPath) : (getCurrentDocumentText() || activePreviewPath);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activePreviewPath, getCurrentDocumentText, gitDiffData, isDiffPreview]);

  const handleEditorChange = useCallback((value: string) => {
    setDraftContent(value);
    setSaveError((current) => (current ? null : current));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setSaveError(null);
    setDraftContent(content);
    setRenderedContent(content);
    setContentVersion((current) => current + 1);
    setFileState((current) =>
      current
        ? {
            ...current,
            lineCount: getLineCount(content),
            lineCountExact: true,
            truncated: false,
            binary: false,
          }
        : current
    );
    editorRef.current?.focus();
  }, [content]);

  const handleSave = useCallback(async () => {
    if (saving || !canEdit) return;

    const nextContent = getCurrentDocumentText();
    const nextSize = new TextEncoder().encode(nextContent).length;
    if (nextSize > DOC_PREVIEW_EDIT_MAX_BYTES) {
      setSaveError(
        t("docPreview.saveTooLarge", { maxSize: formatFileSize(DOC_PREVIEW_EDIT_MAX_BYTES) })
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/files/raw", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: fileReference.path,
          content: nextContent,
          baseDir: workingDirectory || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t("docPreview.saveFailed"));
      }
      setContent(nextContent);
      setDraftContent(nextContent);
      setRenderedContent(nextContent);
      setContentVersion((current) => current + 1);
      setFileState((current) =>
        current
          ? {
              ...current,
              mode: getDocPreviewMode(nextSize),
              size: nextSize,
              lineCount: getLineCount(nextContent),
              lineCountExact: true,
              truncated: false,
              binary: false,
            }
          : current
      );
      publishRefreshFileTree();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("docPreview.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [canEdit, fileReference.path, getCurrentDocumentText, saving, t, workingDirectory]);

  const fileName = activePreviewPath.split("/").pop() || activePreviewPath;

  const breadcrumb = useMemo(() => {
    const segments = activePreviewPath.split("/").filter(Boolean);
    const display = segments.slice(-3);
    const prefix = display.length < segments.length ? ".../" : "";
    return prefix + display.join("/");
  }, [activePreviewPath]);

  const lineCountLabel = useMemo(() => {
    if (!fileState || fileState.binary) {
      return null;
    }

    const label = t("docPreview.lines", { count: fileState.lineCount });
    return fileState.lineCountExact ? label : `${label}+`;
  }, [fileState, t]);

  const modeNotice = useMemo(() => {
    if (!fileState) {
      return null;
    }

    if (fileState.binary) {
      return t("docPreview.binaryMode", { size: formatFileSize(fileState.size) });
    }

    if (fileState.mode === "plain") {
      return t("docPreview.plainMode", { size: formatFileSize(fileState.size) });
    }

    if (fileState.mode === "readonly") {
      return t("docPreview.readonlyMode", {
        size: formatFileSize(fileState.size),
        maxSize: formatFileSize(DOC_PREVIEW_EDIT_MAX_BYTES),
      });
    }

    if (fileState.truncated) {
      return t("docPreview.previewTruncated");
    }

    return null;
  }, [fileState, t]);

  const showModeNotice = !loading && !error && Boolean(modeNotice);
  const showSaveControls = !loading && !error && viewMode === "source" && canEdit;
  const dirtyActionButtonClassName =
    "h-7 min-w-[4.5rem] border-border-subtle bg-bg-tertiary text-xs text-sidebar-foreground/88 hover:bg-bg-hover disabled:border-border-subtle disabled:bg-bg-tertiary disabled:text-sidebar-foreground/55";

  const renderPatchBlock = useCallback((title: string, patch: string) => {
    if (!patch.trim()) return null;
    const lines = patch.split("\n");
    let oldLine = 0;
    let newLine = 0;
    return (
      <div className="overflow-hidden rounded-lg border border-border-default/60 bg-black/20">
        <div className="border-b border-border-default/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/60">
          {title}
        </div>
        <div className="overflow-x-auto px-2 py-1 text-[11px] leading-5">
          {lines.map((line, index) => {
            const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (hunkMatch) {
              oldLine = Number(hunkMatch[1]) || 0;
              newLine = Number(hunkMatch[2]) || 0;
            }

            let oldLabel = "";
            let newLabel = "";
            if (line.startsWith("-") && !line.startsWith("---")) {
              oldLabel = String(oldLine || "");
              oldLine += 1;
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
              newLabel = String(newLine || "");
              newLine += 1;
            } else if (!line.startsWith("@@") && !line.startsWith("---") && !line.startsWith("+++")) {
              oldLabel = String(oldLine || "");
              newLabel = String(newLine || "");
              oldLine += 1;
              newLine += 1;
            }

            return (
              <div
                key={`${title}-${index}`}
                className={cn(
                  "grid min-w-full grid-cols-[3.5rem_3.5rem_1fr] font-mono",
                  line.startsWith('+++') || line.startsWith('---')
                    ? "text-sidebar-foreground/70"
                    : line.startsWith('@@')
                    ? "text-blue-400"
                    : line.startsWith('+')
                    ? "text-emerald-300"
                    : line.startsWith('-')
                    ? "text-red-300"
                    : "text-sidebar-foreground/80"
                )}
              >
                <span className="select-none pr-2 text-right text-sidebar-foreground/45">{oldLabel}</span>
                <span className="select-none pr-2 text-right text-sidebar-foreground/45">{newLabel}</span>
                <span className="whitespace-pre">{line || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, []);

  if (isDiffPreview) {
    const hasPatch = Boolean(
      gitDiffData?.stagedPatch?.trim()
      || gitDiffData?.unstagedPatch?.trim()
      || gitDiffData?.untrackedPatch?.trim()
    );
    return (
      <div
        ref={previewRootRef}
        data-doc-preview-root="true"
        className="hidden h-full shrink-0 flex-col overflow-hidden bg-background pl-2 lg:flex"
        style={{ width }}
      >
        <div className="mt-5 flex h-12 shrink-0 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{fileName}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <HugeiconsIcon icon={Tick01Icon} className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
            )}
            <span className="sr-only">{t("docPreview.copyContent")}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
            <span className="sr-only">{t("docPreview.closePreview")}</span>
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">{breadcrumb}</p>
          <span className="rounded-full border border-blue-400/40 bg-blue-500/12 px-2 py-0.5 text-[10px] text-blue-200">
            {t("fileTree.diffTitle")}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {gitDiffLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : gitDiffError ? (
            <div className="px-1 py-4 text-center">
              <p className="text-sm text-destructive">{gitDiffError}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {renderPatchBlock(t("fileTree.diffStaged"), gitDiffData?.stagedPatch || "")}
              {renderPatchBlock(t("fileTree.diffUnstaged"), gitDiffData?.unstagedPatch || "")}
              {renderPatchBlock(t("fileTree.diffUntracked"), gitDiffData?.untrackedPatch || "")}
              {!hasPatch && (
                <p className="text-[11px] text-sidebar-foreground/60">{t("fileTree.diffNoPatch")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={previewRootRef}
      data-doc-preview-root="true"
      className="hidden h-full shrink-0 flex-col overflow-hidden bg-background pl-2 lg:flex"
      style={{ width }}
    >
      <div className="mt-5 flex h-12 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {canUseRenderedView && (
          <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
        )}

        {showSaveControls && (
          <>
            <Button
              variant="outline"
              size="xs"
              className={dirtyActionButtonClassName}
              onClick={() => {
                void handleSave();
              }}
              disabled={saving || !isDirty}
            >
              {saving ? (
                <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
              )}
              {saving ? t("docPreview.saving") : t("common.save")}
            </Button>
            {isDirty && (
              <Button
                variant="outline"
                size="xs"
                className={dirtyActionButtonClassName}
                onClick={handleCancelEdit}
                disabled={saving}
              >
                <HugeiconsIcon icon={Undo02Icon} className="h-3.5 w-3.5" />
                {t("common.undo")}
              </Button>
            )}
          </>
        )}

        <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
          {copied ? (
            <HugeiconsIcon icon={Tick01Icon} className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">{t("docPreview.copyContent")}</span>
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
          <span className="sr-only">{t("docPreview.closePreview")}</span>
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {breadcrumb}
        </p>
        {fileState && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {formatFileSize(fileState.size)}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground/50">{language}</span>
        {lineCountLabel && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">{lineCountLabel}</span>
        )}
      </div>

      {isFileSearchVisible && canSearchInSource && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-border-default/60 bg-bg-tertiary/70 px-2 py-1.5">
            <input
              ref={searchInputRef}
              value={fileSearchQuery}
              onChange={(event) => applyFileSearchQuery(event.target.value, true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  navigateFileSearch(event.shiftKey ? -1 : 1);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFileSearch();
                }
              }}
              placeholder={t("docPreview.searchPlaceholder")}
              className="h-7 min-w-0 flex-1 rounded border border-border-default/60 bg-background px-2 text-xs outline-none ring-0 placeholder:text-muted-foreground/60 focus:border-border-default"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground/70">
              {fileSearchQuery.trim()
                ? t("docPreview.searchResults", {
                    current: activeFileSearchMatch,
                    count: fileSearchMatchCount,
                  })
                : t("docPreview.searchIdle")}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => navigateFileSearch(-1)}
              disabled={fileSearchMatchCount <= 0}
            >
              {t("docPreview.searchPrev")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => navigateFileSearch(1)}
              disabled={fileSearchMatchCount <= 0}
            >
              {t("docPreview.searchNext")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => closeFileSearch()}
            >
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center py-12">
            <HugeiconsIcon
              icon={Loading02Icon}
              className="h-5 w-5 animate-spin text-muted-foreground"
            />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {saveError && (
              <div className="px-3 pb-2">
                <div className="rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
                  {saveError}
                </div>
              </div>
            )}
            {showModeNotice && (
              <div className="px-3 pb-2">
                <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
                  {modeNotice}
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              {fileState?.binary ? (
                <div className="flex h-full items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("docPreview.binaryContentUnavailable")}
                </div>
              ) : viewMode === "rendered" && canUseRenderedView ? (
                <div className="h-full overflow-auto">
                  <RenderedView content={renderedContent} filePath={activePreviewPath} />
                </div>
              ) : (
                <CodeMirrorSourceEditor
                  ref={editorRef}
                  value={draftContent}
                  valueVersion={contentVersion}
                  isDark={isDark}
                  language={language}
                  readOnly={!canEdit}
                  onChange={handleEditorChange}
                  onSaveShortcut={() => {
                    if (isDirty) {
                      void handleSave();
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-6 items-center rounded-full bg-muted p-0.5 text-[11px]">
      <button
        className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
          value === "source"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("source")}
      >
        {t("docPreview.source")}
      </button>
      <button
        className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
          value === "rendered"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => onChange("rendered")}
      >
        {t("docPreview.preview")}
      </button>
    </div>
  );
}

function RenderedView({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}) {
  const { t } = useTranslation();

  if (isHtml(filePath)) {
    return (
      <iframe
        srcDoc={content}
        sandbox=""
        className="h-full w-full border-0"
        title={t("docPreview.htmlPreview")}
      />
    );
  }

  return (
    <div className="break-words overflow-x-hidden px-6 py-4">
      <Streamdown
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        linkSafety={STREAMDOWN_LINK_SAFETY}
        plugins={STREAMDOWN_PLUGINS}
        remarkPlugins={mergeStreamdownRemarkPlugins()}
        shikiTheme={STREAMDOWN_SHIKI_THEME}
      >
        {content}
      </Streamdown>
    </div>
  );
}
