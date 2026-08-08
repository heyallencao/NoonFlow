"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  PlayIcon,
  Search01Icon,
  Message02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
} from "@hugeicons/core-free-icons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { getRuntimeLabel } from "@/lib/runtime-display";
import { cn } from "@/lib/utils";
import type { SessionPreviewTag } from "@/lib/session-preview";

interface ReplaySessionInfo {
  runtime: "claude_code" | "codex";
  sessionId: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  model?: string;
  preview: string;
  previewTags?: SessionPreviewTag[];
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ReplaySessionsResponse {
  sessions: ReplaySessionInfo[];
}

type TranslateFn = ReturnType<typeof useTranslation>["t"];

const PROJECT_FILTER_ALL = "__all__";
const RUNTIME_FILTER_ALL = "__all__";
const PAGE_SIZE_DEFAULT = 8;
const PAGE_SIZE_LG = 10;
const PAGE_SIZE_2XL = 12;
const getReplayReturnToStorageKey = (sessionId: string) => `noonflow:replay-return-to:${sessionId}`;

function useResponsivePageSize(): number {
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  useEffect(() => {
    const update = () => {
      if (window.innerWidth >= 1536) setPageSize(PAGE_SIZE_2XL);
      else if (window.innerWidth >= 1024) setPageSize(PAGE_SIZE_LG);
      else setPageSize(PAGE_SIZE_DEFAULT);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return pageSize;
}

async function fetchSessionReplays(): Promise<ReplaySessionsResponse> {
  const res = await fetch("/api/session-replays");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getPreviewFallback(tags: SessionPreviewTag[], t: TranslateFn): string {
  if (tags.includes("paths") && tags.includes("code")) {
    return t("memory.previewFallback.pathsAndCode") || "Contains paths and code";
  }
  if (tags.includes("attachments")) {
    return t("memory.previewFallback.attachments") || "Contains attachments";
  }
  if (tags.includes("images")) {
    return t("memory.previewFallback.images") || "Contains images";
  }
  if (tags.includes("code")) {
    return t("memory.previewFallback.code") || "Contains code";
  }
  if (tags.includes("paths")) {
    return t("memory.previewFallback.paths") || "Contains file paths";
  }
  return t("memory.previewFallback.generic") || "No preview available";
}

function getPreviewTagLabel(tag: SessionPreviewTag, t: TranslateFn): string {
  switch (tag) {
    case "code":
      return t("memory.previewTag.code") || "code";
    case "paths":
      return t("memory.previewTag.paths") || "paths";
    case "images":
      return t("memory.previewTag.images") || "images";
    case "attachments":
      return t("memory.previewTag.attachments") || "attachments";
    default:
      return tag;
  }
}

export function MemoryRecentSessionsCard() {
  const router = useRouter();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState(PROJECT_FILTER_ALL);
  const [runtimeFilter, setRuntimeFilter] = useState<string>(RUNTIME_FILTER_ALL);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useResponsivePageSize();
  const buildReplayHref = (session: ReplaySessionInfo) =>
    `/sessions/${session.sessionId}?runtime=${session.runtime}&returnTo=${encodeURIComponent("/memory")}`;
  const openReplay = (session: ReplaySessionInfo) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(getReplayReturnToStorageKey(session.sessionId), "/memory");
    }
    router.push(buildReplayHref(session));
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["memory-recent-sessions"],
    queryFn: fetchSessionReplays,
  });

  const sessions = useMemo(() => data?.sessions ?? [], [data?.sessions]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const session of sessions) {
      if (!session.projectName) continue;
      set.add(session.projectName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (projectFilter !== PROJECT_FILTER_ALL && session.projectName !== projectFilter) {
        return false;
      }

      if (runtimeFilter !== RUNTIME_FILTER_ALL && session.runtime !== runtimeFilter) {
        return false;
      }

      if (!keyword) return true;

      const fields = [
        session.runtime,
        session.sessionId,
        session.projectName,
        session.projectPath,
        session.cwd,
        session.gitBranch,
        session.model,
        session.preview,
      ];
      return fields.some((field) => field && field.toLowerCase().includes(keyword));
    });
  }, [sessions, query, projectFilter, runtimeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pagedSessions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSessions.slice(start, start + pageSize);
  }, [currentPage, filteredSessions, pageSize]);

  const totalMessages = useMemo(
    () => sessions.reduce((sum, item) => sum + item.userMessageCount + item.assistantMessageCount, 0),
    [sessions]
  );

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:mb-5 sm:grid-cols-2 sm:gap-3 lg:mb-6 xl:grid-cols-4 lg:gap-3.5">
        <MetricCard
          variant="compact"
          label={t("memory.totalSessions") || "Total Sessions"}
          value={sessions.length}
          indicatorClassName="bg-blue-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t("memory.projects") || "Projects"}
          value={projectOptions.length}
          indicatorClassName="bg-emerald-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t("memory.totalMessages") || "Total Messages"}
          value={totalMessages}
          indicatorClassName="bg-amber-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t("memory.filteredSessions") || "Filtered Sessions"}
          value={filteredSessions.length}
          indicatorClassName="bg-cyan-400"
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="flex h-9 items-center rounded-md border border-input p-1">
              {[
                { value: RUNTIME_FILTER_ALL, label: t("memory.runtimeAll") || "All" },
                { value: "claude_code", label: t("memory.runtimeClaude") || "Claude" },
                { value: "codex", label: t("memory.runtimeCodex") || "Codex" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setRuntimeFilter(option.value);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                    runtimeFilter === option.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-white/[0.04] md:w-64 shrink-0"
                >
                  <span className="flex items-center gap-2 truncate">
                    <HugeiconsIcon icon={Folder01Icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {projectFilter === PROJECT_FILTER_ALL
                        ? (t("memory.filterAllProjects") || "All projects")
                        : projectFilter}
                    </span>
                  </span>
                  <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("memory.searchProject") || "Search project..."} />
                  <CommandList>
                    <CommandEmpty>{t("memory.noProjectFound") || "No project found."}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value={PROJECT_FILTER_ALL}
                        onSelect={() => {
                          setProjectFilter(PROJECT_FILTER_ALL);
                          setPage(1);
                          setProjectPickerOpen(false);
                        }}
                      >
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          className={`h-3.5 w-3.5 shrink-0 ${projectFilter === PROJECT_FILTER_ALL ? "opacity-100" : "opacity-0"}`}
                        />
                        {t("memory.filterAllProjects") || "All projects"}
                      </CommandItem>
                      {projectOptions.map((name) => (
                        <CommandItem
                          key={name}
                          value={name}
                          onSelect={() => {
                            setProjectFilter(name);
                            setPage(1);
                            setProjectPickerOpen(false);
                          }}
                        >
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            className={`h-3.5 w-3.5 shrink-0 ${projectFilter === name ? "opacity-100" : "opacity-0"}`}
                          />
                          {name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <div className="relative flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                placeholder={t("memory.searchPlaceholder") || "Search sessions..."}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {error ? (
            <p className="py-3 text-sm text-red-500">
              {error instanceof Error ? error.message : "Failed to load sessions"}
            </p>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 py-3 text-center text-muted-foreground">
              <HugeiconsIcon icon={DatabaseIcon} className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {sessions.length === 0
                  ? t("memory.noRecentSessions") || "No recent sessions."
                  : t("memory.filteredEmpty") || "No sessions matched the current filters."}
              </p>
            </div>
          ) : (
            <div>
              <div className="space-y-2">
                {pagedSessions.map((session) => {
                  const totalMessageCount = session.userMessageCount + session.assistantMessageCount;
                  const previewTags = session.previewTags ?? [];
                  const previewText = session.preview || getPreviewFallback(previewTags, t);
                  return (
                    <div
                      key={`${session.runtime}-${session.sessionId}`}
                      className="group flex cursor-pointer items-start gap-4 rounded-xl border border-transparent px-3.5 py-3 transition-colors hover:border-border/50 hover:bg-bg-secondary/35"
                      onClick={() => {
                        openReplay(session);
                      }}
                    >
                      <div className={cn(
                        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                        session.runtime === "codex" ? "bg-emerald-500" : "bg-blue-500"
                      )} />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium leading-5 text-foreground/90">
                          {previewText}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                          <span className="font-medium text-blue-400/95">
                            {session.projectName || "Unknown"}
                          </span>
                          <span className="text-muted-foreground/30">•</span>
                          <span className="inline-flex items-center gap-1">
                            <span className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              session.runtime === "codex" ? "bg-emerald-500" : "bg-blue-500"
                            )} />
                            <span>{getRuntimeLabel(session.runtime)}</span>
                          </span>
                          <span className="text-muted-foreground/30">•</span>
                          <span className="tabular-nums">{formatRelativeTime(session.updatedAt)}</span>
                          {totalMessageCount > 0 && (
                            <>
                              <span className="text-muted-foreground/30">•</span>
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <HugeiconsIcon icon={Message02Icon} className="h-3.5 w-3.5" />
                                {totalMessageCount}
                              </span>
                            </>
                          )}
                        </div>

                        {previewTags.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {previewTags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                              >
                                {getPreviewTagLabel(tag, t)}
                              </span>
                            ))}
                          </div>
                        )}

                        {session.model && (
                          <div className="mt-2 truncate text-[11px] text-muted-foreground/55">
                            {session.model}
                          </div>
                        )}
                      </div>

                      <button
                        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-blue-500/10 hover:text-blue-400"
                        onClick={(event) => {
                          event.stopPropagation();
                          openReplay(session);
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <HugeiconsIcon icon={PlayIcon} className="h-3.5 w-3.5" />
                          <span>{t("memory.openSession") || "Replay"}</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage <= 1}
                  >
                    {t("memory.prevPage") || "Prev"}
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("memory.pageInfo", { current: currentPage, total: totalPages }) || `Page ${currentPage}/${totalPages}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    {t("memory.nextPage") || "Next"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
