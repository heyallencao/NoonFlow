"use client";

import { Fragment, cloneElement, isValidElement, useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Copy01Icon, Tick01Icon, Loading02Icon, Search01Icon, ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import type { FilePreview as FilePreviewType } from "@/types";

interface FilePreviewProps {
  filePath: string;
  onBack: () => void;
}

function parseFileReference(fileReference: string): { path: string; line: number | null } {
  const hashMatch = fileReference.match(/^(.*?)(?:#L(\d+)(?:C\d+)?)?$/i);
  if (hashMatch) {
    const parsedLine = hashMatch[2] ? Number.parseInt(hashMatch[2], 10) : NaN;
    if (Number.isFinite(parsedLine)) {
      return {
        path: hashMatch[1] || fileReference,
        line: parsedLine,
      };
    }
  }

  // Also support "path:line[:column]" style references.
  const colonMatch = fileReference.match(/^(.*):(\d+)(?::\d+)?$/);
  if (colonMatch) {
    const parsedLine = Number.parseInt(colonMatch[2], 10);
    if (Number.isFinite(parsedLine)) {
      return {
        path: colonMatch[1] || fileReference,
        line: parsedLine,
      };
    }
  }

  return { path: fileReference, line: null };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearchMatches(node: ReactNode, query: string, isActiveLine: boolean): ReactNode {
  if (!query) {
    return node;
  }

  if (typeof node === "string") {
    const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
    const parts = node.split(regex);
    if (parts.length === 1) {
      return node;
    }
    return parts.map((part, index) => {
      if (part.toLowerCase() !== query.toLowerCase()) {
        return part;
      }
      return (
        <mark
          key={`${part}-${index}`}
          className={isActiveLine ? "rounded bg-sky-400/35 px-0.5 text-inherit" : "rounded bg-amber-300/30 px-0.5 text-inherit"}
        >
          {part}
        </mark>
      );
    });
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{highlightSearchMatches(child, query, isActiveLine)}</Fragment>
    ));
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    const children = highlightSearchMatches(node.props.children, query, isActiveLine);
    return cloneElement(node, node.props, children);
  }

  return node;
}

export function FilePreview({ filePath, onBack }: FilePreviewProps) {
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const fileReference = useMemo(() => parseFileReference(filePath), [filePath]);
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(fileReference.path)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t('filePreview.failedToLoad'));
        }
        const data = await res.json();
        setPreview(data.preview);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('filePreview.failedToLoad'));
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [fileReference.path, t, workingDirectory]);

  const handleCopyPath = async () => {
    await navigator.clipboard.writeText(fileReference.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const lineMatches = useMemo(() => {
    if (!preview?.content || !normalizedSearchQuery) {
      return [] as number[];
    }
    return preview.content
      .split('\n')
      .flatMap((line, index) => line.toLowerCase().includes(normalizedSearchQuery) ? [index + 1] : []);
  }, [normalizedSearchQuery, preview?.content]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [normalizedSearchQuery, filePath]);

  useEffect(() => {
    if (!normalizedSearchQuery || lineMatches.length === 0) {
      return;
    }
    const activeLine = lineMatches[Math.min(activeMatchIndex, lineMatches.length - 1)];
    const container = scrollAreaRef.current;
    if (!container || !activeLine) {
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-file-preview-line="${activeLine}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeMatchIndex, lineMatches, normalizedSearchQuery]);

  useEffect(() => {
    if (normalizedSearchQuery || !fileReference.line) {
      return;
    }
    const container = scrollAreaRef.current;
    if (!container) {
      return;
    }
    const timer = window.setTimeout(() => {
      const target = container.querySelector<HTMLElement>(`[data-file-preview-line="${fileReference.line}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fileReference.line, normalizedSearchQuery, preview?.content]);

  // Extract filename from path
  // Build breadcrumb segments
  const segments = fileReference.path.split("/").filter(Boolean);
  const displaySegments = segments.slice(-3); // show last 3 segments
  const activeLineNumber = lineMatches[Math.min(activeMatchIndex, Math.max(lineMatches.length - 1, 0))];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
          <span className="sr-only">{t('filePreview.backToTree')}</span>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {displaySegments.length < segments.length && ".../"}{displaySegments.join("/")}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleCopyPath}>
          {copied ? (
            <HugeiconsIcon icon={Tick01Icon} className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <HugeiconsIcon icon={Copy01Icon} className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">{t('filePreview.copyPath')}</span>
        </Button>
      </div>

      {/* File info */}
      {preview && (
        <div className="flex items-center gap-2 pb-2">
          <Badge variant="secondary" className="text-[10px]">
            {preview.language}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {t('filePreview.lines', { count: preview.line_count })}
          </span>
        </div>
      )}

      {preview && (
        <div className="pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2">
            <HugeiconsIcon icon={Search01Icon} className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('filePreview.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {normalizedSearchQuery ? `${lineMatches.length}` : t('filePreview.searchIdle')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={lineMatches.length === 0}
              onClick={() => setActiveMatchIndex((current) => (current - 1 + lineMatches.length) % lineMatches.length)}
            >
              <HugeiconsIcon icon={ArrowUp01Icon} className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={lineMatches.length === 0}
              onClick={() => setActiveMatchIndex((current) => (current + 1) % lineMatches.length)}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1" viewportRef={scrollAreaRef}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="mt-2 text-xs"
            >
              {t('filePreview.backToTree')}
            </Button>
          </div>
        ) : preview ? (
          <div className="rounded-md border border-border text-xs">
            <SyntaxHighlighter
              language={preview.language}
              style={atomOneDark}
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: "8px",
                borderRadius: "6px",
                fontSize: "11px",
                lineHeight: "1.5",
              }}
              lineNumberStyle={{
                minWidth: "2.5em",
                paddingRight: "8px",
                color: "#636d83",
                userSelect: "none",
              }}
              wrapLines
              lineProps={(lineNumber) => {
                return {
                  'data-file-preview-line': String(lineNumber),
                  style: {
                    display: 'block',
                    boxShadow: lineNumber === activeLineNumber ? 'inset 2px 0 0 rgba(56, 189, 248, 0.65)' : 'none',
                  },
                };
              }}
              renderer={({ rows }) => rows.map((row, index) => {
                const lineNumber = index + 1;
                return (
                  <Fragment key={lineNumber}>
                    {highlightSearchMatches(row as ReactNode, normalizedSearchQuery, lineNumber === activeLineNumber)}
                  </Fragment>
                );
              })}
            >
              {preview.content}
            </SyntaxHighlighter>
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
