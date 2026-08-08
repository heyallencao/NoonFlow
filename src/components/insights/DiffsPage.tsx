'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/ui/metric-card';
import { FileCode, Plus, Minus, AlertCircle, ChevronRight, LoaderCircle, FolderGit2 } from 'lucide-react';
import { CodebaseHeader } from './CodebaseHeader';
import { useCodebaseNavigation } from '@/hooks/useCodebaseNavigation';
import { getWorkspaceName } from '@/lib/workspace-utils';
import { cn } from '@/lib/utils';
import type { GitRepoStatus } from '@/lib/git/types';

interface DiffItem {
  sessionId: string | null;
  workspacePath: string;
  repoRoot: string;
  changedFilesCount: number;
  insertions: number;
  deletions: number;
  updatedAt: string;
  changedFiles?: GitRepoStatus['changedFiles'];
}

interface DiffsData {
  groups: Array<{
    label: string;
    items: DiffItem[];
  }>;
}

interface GitFileDiffResponse {
  repoRoot: string;
  file: string;
  stagedPatch: string;
  unstagedPatch: string;
  untrackedPatch: string;
}

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function isGenericDiffGroupLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === 'recent changes' || normalized === 'recent change';
}

function getDiffLineTone(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'bg-transparent text-foreground/62';
  }
  if (line.startsWith('@@')) {
    return 'bg-sky-500/8 text-sky-300';
  }
  if (line.startsWith('+')) {
    return 'bg-emerald-500/8 text-emerald-300';
  }
  if (line.startsWith('-')) {
    return 'bg-rose-500/8 text-rose-300';
  }
  return 'bg-transparent text-foreground/72';
}

function getPatchSections(diffData: GitFileDiffResponse | null) {
  if (!diffData) return [];

  return [
    { key: 'staged', label: 'Staged', patch: diffData.stagedPatch },
    { key: 'unstaged', label: 'Unstaged', patch: diffData.unstagedPatch },
    { key: 'untracked', label: 'Untracked', patch: diffData.untrackedPatch },
  ].filter((section) => section.patch.trim().length > 0);
}

function formatDiffDateLabel(dateString: string, t: TranslateFn): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return t('timeline.today') || 'Today';
  if (days === 1) return t('timeline.yesterday') || 'Yesterday';
  if (days < 7) return `${days}${t('timeline.daysAgo') || 'd ago'}`;

  return date.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
  });
}

export function DiffsPage() {
  const { t } = useTranslation();
  const loadFailedMessage = t('insights.loadFailed');
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const [data, setData] = useState<DiffsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const effectiveSelectedWorkspace = useMemo(
    () => (selectedWorkspace && workspacePaths.includes(selectedWorkspace) ? selectedWorkspace : null),
    [selectedWorkspace, workspacePaths]
  );
  const isAllWorkspaces = effectiveSelectedWorkspace === null;

  const activeWorkspaces = useMemo(() => {
    if (!effectiveSelectedWorkspace) {
      return workspacePaths;
    }
    return [effectiveSelectedWorkspace];
  }, [effectiveSelectedWorkspace, workspacePaths]);

  const fetchDiffs = useCallback(async () => {
    if (activeWorkspaces.length === 0) {
      setLoading(false);
      setData({ groups: [] });
      return;
    }
    try {
      setLoading(true);
      // Fetch diffs for all active workspaces
      const results = await Promise.all(
        activeWorkspaces.map(async (workspace) => {
          const res = await fetch(`/api/diffs?workspace=${encodeURIComponent(workspace)}`);
          if (!res.ok) {
            throw new Error(loadFailedMessage);
          }
          return res.json();
        })
      );
      // Merge results from all workspaces
      const merged: DiffsData = { groups: [] };
      for (const result of results) {
        if (result.groups) {
          merged.groups.push(...result.groups);
        }
      }
      setData(merged);
    } catch {
      setError(loadFailedMessage);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaces, loadFailedMessage]);

  useEffect(() => {
    void fetchDiffs();
  }, [fetchDiffs]);

  const mergedGroups = useMemo(() => {
    const sourceGroups = data?.groups ?? [];
    const grouped = new Map<string, DiffItem[]>();

    for (const group of sourceGroups) {
      const items = grouped.get(group.label) ?? [];
      items.push(...group.items);
      grouped.set(group.label, items);
    }

    return Array.from(grouped.entries()).map(([label, items]) => ({
      label,
      items: items
        .slice()
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    }));
  }, [data]);

  const showGroupLabels = useMemo(() => {
    if (mergedGroups.length !== 1) return true;
    return !isGenericDiffGroupLabel(mergedGroups[0]?.label ?? '');
  }, [mergedGroups]);

  const totalChanges = useMemo(() => mergedGroups.reduce((sum, group) => sum + group.items.length, 0), [mergedGroups]);
  const totalInsertions = useMemo(() => mergedGroups.reduce((sum, group) => sum + group.items.reduce((s, i) => s + i.insertions, 0), 0), [mergedGroups]);
  const totalDeletions = useMemo(() => mergedGroups.reduce((sum, group) => sum + group.items.reduce((s, i) => s + i.deletions, 0), 0), [mergedGroups]);

  if (activeWorkspaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="h-16 w-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mx-auto mb-4 text-2xl">
            🔍
          </div>
          <h3 className="text-lg font-bold text-foreground">{t('diffs.noSelection') || 'No Selection'}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('diffs.noSelectionDesc') || 'Select a workspace to track codebase changes.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 bg-background text-foreground">
      <CodebaseHeader
        title={t('diffs.title')}
        description={isAllWorkspaces ? `${t('diffs.trackingChanges') || 'Tracking changes across'} ${activeWorkspaces.length} ${activeWorkspaces.length === 1 ? (t('diffs.workspace') || 'workspace') : (t('diffs.workspaces') || 'workspaces')}` : `${t('diffs.codeChurn') || 'Code churn in'} ${getWorkspaceName(effectiveSelectedWorkspace)}`}
        selectedWorkspace={effectiveSelectedWorkspace}
        onWorkspaceChange={setSelectedWorkspace}
        action={
          <button
            onClick={fetchDiffs}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-bg-tertiary px-3 text-[12px] font-semibold hover:bg-bg-hover disabled:opacity-50 transition-colors"
          >
            {loading && !data ? '...' : loading ? (t('diffs.refreshing') || '...') : t('common.refresh') || 'Refresh'}
          </button>
        }
      >
        <MetricCard
          variant="compact"
          label={t('diffs.modifiedRepos') || 'Modified Repos'}
          value={totalChanges}
          indicatorClassName="bg-blue-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('diffs.insertions') || 'Insertions'}
          value={totalInsertions}
          indicatorClassName="bg-emerald-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('diffs.deletions') || 'Deletions'}
          value={totalDeletions}
          indicatorClassName="bg-rose-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
      </CodebaseHeader>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-[13px] font-medium flex items-center gap-3">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {data && totalChanges === 0 && !loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-subtle/60 bg-bg-secondary p-16 text-center shadow-[var(--shadow-lg)]">
          <FileCode className="h-12 w-12 text-muted-foreground/20 mb-4" />
          <h3 className="text-lg font-bold text-foreground">{t('diffs.noChanges')}</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {t('diffs.noChangesDescription')}
          </p>
        </div>
      )}

      <div className="space-y-2 pb-10">
        {mergedGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="space-y-3">
            {group.items.length > 0 && (
              <>
                {showGroupLabels ? (
                  <h2 className="px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">
                    {group.label}
                  </h2>
                ) : null}
                <div className="grid gap-2">
                  {group.items.map((item, itemIndex) => (
                    <DiffCard key={`${groupIndex}-${itemIndex}`} item={item} />
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCard({ item }: { item: DiffItem }) {
  const { t } = useTranslation();
  const loadFailedMessage = t('insights.loadFailed');
  const { focusRepo } = useCodebaseNavigation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [fileDiffs, setFileDiffs] = useState<Record<string, GitFileDiffResponse>>({});
  const [fileDiffLoadingPath, setFileDiffLoadingPath] = useState<string | null>(null);
  const [fileDiffErrors, setFileDiffErrors] = useState<Record<string, string>>({});
  const formattedDate = useMemo(() => formatDiffDateLabel(item.updatedAt, t), [item.updatedAt, t]);
  const changedFiles = item.changedFiles ?? [];
  const canExpand = changedFiles.length > 0;
  const repoName = getWorkspaceName(item.repoRoot);
  const workspaceName = getWorkspaceName(item.workspacePath);
  const showWorkspaceLabel = workspaceName !== repoName;

  const getFileIcon = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return <span className="text-blue-400">TS</span>;
      case 'js':
      case 'jsx':
        return <span className="text-yellow-400">JS</span>;
      case 'css':
      case 'scss':
        return <span className="text-pink-400">CSS</span>;
      case 'json':
        return <span className="text-orange-400">JSON</span>;
      case 'md':
        return <span className="text-slate-300">MD</span>;
      default:
        return <FileCode className="h-3.5 w-3.5 text-muted-foreground/60" />;
    }
  };

  const handleToggleRepo = useCallback(() => {
    if (!canExpand) return;

    setIsExpanded((previous) => {
      const next = !previous;
      if (!next) {
        setActiveFilePath(null);
      }
      return next;
    });
  }, [canExpand]);

  const handleToggleFileDiff = useCallback(
    async (filePath: string) => {
      if (activeFilePath === filePath) {
        setActiveFilePath(null);
        return;
      }

      setActiveFilePath(filePath);

      if (fileDiffs[filePath]) {
        return;
      }

      setFileDiffLoadingPath(filePath);
      setFileDiffErrors((current) => {
        if (!current[filePath]) return current;
        const next = { ...current };
        delete next[filePath];
        return next;
      });

      try {
        const response = await fetch(
          `/api/git/diff?cwd=${encodeURIComponent(item.repoRoot)}&file=${encodeURIComponent(filePath)}`
        );
        const payload = (await response.json().catch(() => null)) as (GitFileDiffResponse & { error?: string }) | null;

        if (!response.ok || !payload || payload.error) {
          throw new Error(loadFailedMessage);
        }

        setFileDiffs((current) => ({
          ...current,
          [filePath]: payload,
        }));
      } catch {
        setFileDiffErrors((current) => ({
          ...current,
          [filePath]: loadFailedMessage,
        }));
      } finally {
        setFileDiffLoadingPath((current) => (current === filePath ? null : current));
      }
    },
    [activeFilePath, fileDiffs, item.repoRoot, loadFailedMessage]
  );

  return (
    <section className="group relative min-h-[74px] rounded-2xl border border-border-subtle/35 bg-card px-2.5 py-2.5 shadow-[var(--shadow-lg)] transition-colors duration-200 hover:bg-bg-secondary sm:min-h-[78px] lg:min-h-[82px]">
      <div className="flex flex-col gap-2.5 sm:min-h-full sm:flex-row sm:items-stretch sm:justify-between">
          <button
            type="button"
            onClick={handleToggleRepo}
            disabled={!canExpand}
            aria-expanded={canExpand ? isExpanded : undefined}
            className={cn(
              'min-w-0 text-left sm:self-stretch',
              !canExpand && 'cursor-default'
            )}
          >
            <div className="flex h-full max-w-full items-center gap-3 rounded-xl border border-border-subtle/40 bg-bg-secondary/78 px-3 py-2.5 shadow-sm transition-colors group-hover:bg-bg-tertiary/82">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle/40 bg-bg-primary text-sky-300/92 shadow-sm">
                <FolderGit2 className="h-4 w-4" />
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-[14px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-foreground">
                    {repoName}
                  </h3>
                  {item.sessionId ? (
                    <Badge variant="outline" className="h-5 rounded-full border-emerald-500/18 bg-emerald-500/10 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300/92">
                      {t('diffs.active') || 'Active'}
                    </Badge>
                  ) : null}
                  {showWorkspaceLabel ? (
                    <span className="inline-flex h-5 max-w-full items-center rounded-full border border-border-subtle/45 bg-bg-primary px-2 text-[10px] font-medium text-foreground/58">
                      <span className="truncate">{workspaceName}</span>
                    </span>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border-subtle/45 bg-bg-primary px-2.5 text-[11px] font-medium text-foreground/72">
                    <FileCode className="h-3.5 w-3.5 text-muted-foreground/52" />
                    {item.changedFilesCount} {t('diffs.files') || 'files'}
                  </span>
                  <span className="inline-flex h-6 items-center gap-1 rounded-full border border-emerald-500/15 bg-emerald-500/8 px-2.5 text-[11px] font-semibold tabular-nums text-emerald-300/90">
                    <Plus className="h-3 w-3" />
                    {item.insertions}
                  </span>
                  <span className="inline-flex h-6 items-center gap-1 rounded-full border border-rose-500/15 bg-rose-500/8 px-2.5 text-[11px] font-semibold tabular-nums text-rose-300/90">
                    <Minus className="h-3 w-3" />
                    {item.deletions}
                  </span>
                </div>
              </div>
            </div>
          </button>

          <div className="flex items-center justify-between gap-2 rounded-xl border border-border-subtle/40 bg-bg-secondary/62 px-2 py-2 shadow-sm sm:min-h-full sm:self-stretch sm:justify-end">
            <div className="inline-flex h-6 items-center rounded-full border border-border-subtle/45 bg-bg-secondary px-2.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground/72">
              {formattedDate}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle/45 bg-bg-secondary px-3 text-[11px] font-semibold text-foreground/74 transition-colors hover:bg-bg-tertiary hover:text-foreground"
                onClick={() => focusRepo({ repoPath: item.repoRoot, workspacePath: item.workspacePath })}
              >
                {t('diffs.review') || 'Review'}
              </button>
              {canExpand ? (
                <button
                  type="button"
                  onClick={handleToggleRepo}
                  aria-label={isExpanded ? 'Collapse repo changes' : 'Expand repo changes'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle/45 bg-bg-secondary text-muted-foreground/62 transition-colors hover:bg-bg-tertiary hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )}
                  />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {isExpanded && canExpand ? (
          <div className="relative pl-2 sm:pl-[3.25rem]">
            <div className="pointer-events-none absolute bottom-0 left-[1.05rem] top-0 w-px bg-gradient-to-b from-sky-500/35 via-border-subtle/35 to-transparent sm:left-[1.78rem]" />
            <div className="pl-3 sm:pl-4">
              <div className="flex items-center justify-between pb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/50">
                <span>{t('diffs.files') || 'Files'}</span>
                <span>{changedFiles.length}</span>
              </div>
              <div className="max-h-[min(32rem,calc(100vh-17rem))] overflow-y-auto pr-1">
                <div className="space-y-0">
                  {changedFiles.map((file) => {
                    const isFileOpen = activeFilePath === file.path;
                    const fileDiff = fileDiffs[file.path] ?? null;
                    const patchSections = getPatchSections(fileDiff);
                    const fileError = fileDiffErrors[file.path];
                    const isLoadingFile = fileDiffLoadingPath === file.path;
                    const hasPatch = patchSections.length > 0;

                    return (
                      <div key={file.path} className="relative border-t border-border-subtle/20 pl-5 first:border-t-0">
                        <div className="absolute left-0 top-4 h-px w-3 bg-border-subtle/45" />
                        <div className="absolute left-0 top-[0.84rem] h-2 w-2 rounded-full bg-sky-400/88" />

                        <div className="overflow-hidden">
                          <button
                            type="button"
                            onClick={() => void handleToggleFileDiff(file.path)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-colors hover:bg-bg-secondary/45"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="flex h-5 min-w-5 items-center justify-center text-[8px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
                                  {getFileIcon(file.path)}
                                </div>
                                <span className="truncate font-mono text-[12px] font-medium text-foreground/80">
                                  {file.path}
                                </span>
                                <ChevronRight
                                  className={cn(
                                    'h-3.5 w-3.5 shrink-0 text-muted-foreground/45 transition-transform duration-200',
                                    isFileOpen && 'rotate-90'
                                  )}
                                />
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground/58">
                                {file.index !== ' ' ? (
                                  <span className="text-emerald-300/82">
                                    {t('diffs.staged') || 'Staged'}
                                  </span>
                                ) : null}
                                {file.working_dir !== ' ' ? (
                                  <span className="text-amber-300/82">
                                    {t('diffs.dirty') || 'Dirty'}
                                  </span>
                                ) : null}
                                {file.index === ' ' && file.working_dir === ' ' ? (
                                  <span>
                                    View
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/42">
                              Diff
                            </span>
                          </button>

                          {isFileOpen ? (
                            <div className="border-t border-border-subtle/20 bg-bg-secondary/60">
                              {isLoadingFile ? (
                                <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground/72">
                                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  <span>{t('common.loading') || 'Loading'} diff...</span>
                                </div>
                              ) : fileError ? (
                                <div className="px-3 py-4 text-xs font-medium text-destructive">
                                  {fileError}
                                </div>
                              ) : hasPatch ? (
                                <div className="space-y-px bg-border-subtle/20">
                                  {patchSections.map((section) => (
                                    <PatchBlock
                                      key={section.key}
                                      title={
                                        section.key === 'staged'
                                          ? t('diffs.staged') || section.label
                                          : section.key === 'unstaged'
                                          ? t('diffs.dirty') || section.label
                                          : section.label
                                      }
                                      patch={section.patch}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-4 text-xs text-muted-foreground/72">
                                  {t('fileTree.diffNoPatch') || 'No patch available'}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}
    </section>
  );
}

function PatchBlock({ title, patch }: { title: string; patch: string }) {
  const lines = useMemo(() => {
    return patch
      .split('\n')
      .reduce<{
        cursor: { oldLine: number; newLine: number };
        rows: Array<{ line: string; oldLabel: string; newLabel: string }>;
      }>(
        (state, line) => {
          const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          const baseCursor = hunkMatch
            ? {
                oldLine: Number(hunkMatch[1]) || 0,
                newLine: Number(hunkMatch[2]) || 0,
              }
            : state.cursor;

          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isContext = !line.startsWith('@@') && !line.startsWith('---') && !line.startsWith('+++');

          const oldLabel = isRemoved || isContext ? String(baseCursor.oldLine || '') : '';
          const newLabel = isAdded || isContext ? String(baseCursor.newLine || '') : '';

          const nextCursor = isRemoved
            ? { oldLine: baseCursor.oldLine + 1, newLine: baseCursor.newLine }
            : isAdded
            ? { oldLine: baseCursor.oldLine, newLine: baseCursor.newLine + 1 }
            : isContext
            ? { oldLine: baseCursor.oldLine + 1, newLine: baseCursor.newLine + 1 }
            : baseCursor;

          return {
            cursor: nextCursor,
            rows: [...state.rows, { line, oldLabel, newLabel }],
          };
        },
        {
          cursor: { oldLine: 0, newLine: 0 },
          rows: [],
        }
      )
      .rows;
  }, [patch]);

  return (
    <div className="border-t border-border-subtle/28 bg-bg-secondary first:border-t-0">
      <div className="border-b border-border-subtle/28 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/62">
        {title}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-max px-4 py-2 font-mono text-[11px] leading-5">
          {lines.map(({ line, oldLabel, newLabel }, index) => {
            return (
              <div
                key={`${title}-${index}`}
                className={cn(
                  'grid min-w-full grid-cols-[3rem_3rem_1fr] border-b border-border-subtle/14 last:border-b-0',
                  getDiffLineTone(line)
                )}
              >
                <span className="select-none pr-2 text-right text-foreground/32">{oldLabel}</span>
                <span className="select-none pr-2 text-right text-foreground/32">{newLabel}</span>
                <span className="whitespace-pre pr-3">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
