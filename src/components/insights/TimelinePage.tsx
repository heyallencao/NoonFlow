'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MetricCard } from '@/components/ui/metric-card';
import { ChevronDown, ChevronRight, Folder01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionsQuery } from '@/lib/queries/session-queries';
import { buildWorkspaceList, getWorkspaceName } from '@/lib/workspace-utils';
import { CodebaseHeader } from './CodebaseHeader';
import { useCodebaseNavigation } from '@/hooks/useCodebaseNavigation';
import { useTranslation } from '@/hooks/useTranslation';
import type { ChatSession } from '@/types';

interface BranchInfo {
  name: string;
  current: boolean;
  commitCount: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}

interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  branch: string;
}

interface RepoTimeline {
  workspacePath: string;
  repoPath: string;
  repoName: string;
  branches: BranchInfo[];
  commits: CommitInfo[];
}

interface TimelineData {
  repos: number;
  branches: number;
  commits: number;
  timelines: RepoTimeline[];
}

async function fetchTimeline(workspacePaths: string[]): Promise<TimelineData> {
  if (workspacePaths.length === 0) return { repos: 0, branches: 0, commits: 0, timelines: [] };
  const params = new URLSearchParams({ maxCommits: '40' });
  for (const workspacePath of workspacePaths) {
    params.append('workspace', workspacePath);
  }
  const response = await fetch(`/api/git/timeline?${params}`);
  if (!response.ok) throw new Error('Failed to fetch git timeline');
  return response.json();
}

export default function TimelinePage() {
  const { t } = useTranslation();
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((state) => state.hiddenWorkspaces);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrate);
  const mergeWorkspacePaths = useWorkspaceStore((state) => state.mergeWorkspacePaths);
  const sessionsQuery = useSessionsQuery('all');
  const sessions = useMemo<ChatSession[]>(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions]
  );

  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);

  useEffect(() => {
    hydrateWorkspaces();
  }, [hydrateWorkspaces]);

  useEffect(() => {
    const fromSessions = sessions
      .map((session) => session.working_directory)
      .filter((value): value is string => Boolean(value));
    if (fromSessions.length > 0) {
      mergeWorkspacePaths(fromSessions);
    }
  }, [sessions, mergeWorkspacePaths]);

  const workspaceItems = useMemo(
    () => buildWorkspaceList({
      workspaces: workspacePaths,
      hiddenWorkspaces,
      sessions,
    }),
    [workspacePaths, hiddenWorkspaces, sessions]
  );
  const availableWorkspacePaths = useMemo(
    () => workspaceItems.map((workspace) => workspace.path),
    [workspaceItems]
  );
  const effectiveSelectedWorkspace = useMemo(
    () => (selectedWorkspace && availableWorkspacePaths.includes(selectedWorkspace) ? selectedWorkspace : null),
    [availableWorkspacePaths, selectedWorkspace]
  );
  const isAllWorkspaces = effectiveSelectedWorkspace === null;
  
  const visibleWorkspacePaths = useMemo(() => {
    if (!effectiveSelectedWorkspace) {
      return availableWorkspacePaths;
    }
    return [effectiveSelectedWorkspace];
  }, [availableWorkspacePaths, effectiveSelectedWorkspace]);

  const scopeKey = visibleWorkspacePaths.join('||');

  const [expandedState, setExpandedState] = useState<{
    scope: string;
    repos: Set<string>;
  }>({ scope: '', repos: new Set() });

  // Track which repos have "show more" expanded beyond default limit
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const DEFAULT_COMMITS_LIMIT = 5;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['git-timeline', scopeKey, 40],
    queryFn: () => fetchTimeline(visibleWorkspacePaths),
    enabled: visibleWorkspacePaths.length > 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const expandedRepos =
    expandedState.scope === scopeKey ? expandedState.repos : new Set<string>();

  const toggleRepo = (repoPath: string) => {
    setExpandedState((prev) => {
      const current =
        prev.scope === scopeKey ? prev.repos : new Set<string>();
      const next = new Set(current);

      if (next.has(repoPath)) {
        next.delete(repoPath);
      } else {
        next.add(repoPath);
      }
      return { scope: scopeKey, repos: next };
    });
  };

  const toggleExpandedCommits = (repoPath: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) {
        next.delete(repoPath);
      } else {
        next.add(repoPath);
      }
      return next;
    });
  };

  const getDisplayedCommits = (repo: NonNullable<typeof data>['timelines'][0]) => {
    const isExpanded = expandedCommits.has(repo.repoPath);
    if (isExpanded || repo.commits.length <= DEFAULT_COMMITS_LIMIT) {
      return repo.commits;
    }
    return repo.commits.slice(0, DEFAULT_COMMITS_LIMIT);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);

    if (days === 0) return t('timeline.today') || 'Today';
    if (days === 1) return t('timeline.yesterday') || 'Yesterday';
    if (days < 7) return `${days}${t('timeline.daysAgo') || 'd ago'}`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  };

  const { focusRepo } = useCodebaseNavigation();

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground animate-pulse font-medium">{t('timeline.loading') || 'Loading...'}</div>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <HugeiconsIcon icon={Folder01Icon} className="h-6 w-6 text-destructive" />
          </div>
          <div className="text-sm font-semibold text-foreground">{message}</div>
          <Button size="sm" onClick={() => void refetch()} disabled={isFetching} variant="outline" className="mt-2">
            {isFetching ? (t('timeline.retrying') || 'Retrying...') : 'Retry'}
          </Button>
        </div>
      </div>
    );
  }

  if (visibleWorkspacePaths.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-xs">
          <div className="h-16 w-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-2">
            <HugeiconsIcon icon={Folder01Icon} className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">{t('timeline.noWorkspaces') || 'No Workspaces'}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t('timeline.noWorkspacesDesc') || 'Add a workspace to track development velocity across your projects.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 bg-background text-foreground">
      <CodebaseHeader
        title={t('timeline.title') || 'Git Timeline'}
        count={data?.commits}
        description={isAllWorkspaces ? `${t('timeline.trackingVelocity') || 'Tracking development velocity'} ${visibleWorkspacePaths.length} ${visibleWorkspacePaths.length === 1 ? (t('timeline.workspace') || 'workspace') : (t('timeline.workspaces') || 'workspaces')}` : `${t('timeline.recentActivity') || 'Recent activity in'} ${getWorkspaceName(effectiveSelectedWorkspace)}`}
        selectedWorkspace={effectiveSelectedWorkspace}
        onWorkspaceChange={setSelectedWorkspace}
        workspaceOptions={workspaceItems.map((workspace) => ({
          path: workspace.path,
          name: workspace.name,
        }))}
        action={
          <Button
            onClick={() => void refetch()}
            variant="outline"
            size="sm"
            disabled={isFetching}
            className="h-8 rounded-lg text-[12px] font-semibold"
          >
            {isFetching ? (t('timeline.refreshing') || 'Refreshing...') : (t('common.refresh') || 'Refresh')}
          </Button>
        }
      >
        <MetricCard
          variant="compact"
          label={t('timeline.repositories') || 'Repositories'}
          value={data?.repos || 0}
          indicatorClassName="bg-blue-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('timeline.activeBranches') || 'Active Branches'}
          value={data?.branches || 0}
          indicatorClassName="bg-amber-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('timeline.totalCommits') || 'Total Commits'}
          value={data?.commits || 0}
          indicatorClassName="bg-emerald-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
      </CodebaseHeader>

      {/* Timeline */}
      <div className="flex-1 space-y-4 pb-12">
        {data?.timelines.map((repo) => (
          <div key={repo.repoPath} className="group/repo animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Repo header */}
            <div
              className="flex items-center justify-between rounded-lg border border-border-subtle/35 bg-card p-3 shadow-[var(--shadow-xl)] transition-all duration-200 hover:bg-bg-secondary"
            >
              <button
                className="flex flex-1 items-center gap-4 text-left min-w-0"
                onClick={() => toggleRepo(repo.repoPath)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-secondary text-blue-500 shadow-sm">
                  <HugeiconsIcon icon={Folder01Icon} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[15px] text-foreground tracking-tight">{repo.repoName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-bold uppercase tracking-wider">
                      {repo.branches.find(b => b.current)?.name || t('timeline.mainBranch') || 'main'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {visibleWorkspacePaths.length > 1 && (
                      <span className="text-[11px] text-muted-foreground font-medium truncate max-w-[150px]">
                        {getWorkspaceName(repo.workspacePath)}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground/60">
                      • {repo.branches.length} {repo.branches.length === 1 ? (t('timeline.branch') || 'branch') : (t('timeline.branches') || 'branches')}
                    </span>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-2 pl-4">
                <button
                  onClick={() => focusRepo({ repoPath: repo.repoPath, workspacePath: repo.workspacePath })}
                  className="h-8 px-3 rounded-lg bg-bg-secondary text-[11px] font-bold text-foreground/80 hover:bg-bg-hover hover:text-foreground shadow-sm transition-all"
                >
                  {t('timeline.focus') || 'Focus'}
                </button>
                <button
                  onClick={() => toggleRepo(repo.repoPath)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-bg-hover transition-colors"
                >
                  <HugeiconsIcon
                    icon={expandedRepos.has(repo.repoPath) ? ChevronDown : ChevronRight}
                    className="h-4 w-4 text-muted-foreground"
                  />
                </button>
              </div>
            </div>

            {/* Commits List */}
            {expandedRepos.has(repo.repoPath) && (
              <div className="ml-8 mt-1 relative pl-6 border-l-2 border-border-subtle/60 space-y-2 py-1">
                {getDisplayedCommits(repo).map((commit, idx) => (
                  <div key={commit.hash + idx} className="relative group/commit">
                    {/* Timeline dot */}
                    <div className="absolute -left-[25px] top-1 w-1.5 h-1.5 rounded-full bg-blue-500 ring-2 ring-background group-hover/commit:scale-125 transition-transform" />

                    <div className="flex justify-between items-start gap-3">
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-[10px]">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(commit.hash);
                              toast.success(t('timeline.hashCopied') || 'Hash copied');
                            }}
                            className="font-mono text-blue-400 font-semibold hover:text-blue-300 transition-colors"
                          >
                            {commit.shortHash}
                          </button>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-emerald-500/80 font-medium truncate max-w-[120px]">
                            {idx === 0 && commit.branch ? commit.branch : ''}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-foreground/70 truncate" title={commit.message}>
                          {commit.message}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[9px] text-muted-foreground/50">{commit.author}</span>
                        <span className="text-[9px] text-muted-foreground/60">{formatDate(commit.date)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Show more button */}
                {repo.commits.length > DEFAULT_COMMITS_LIMIT && (
                  <button
                    onClick={() => toggleExpandedCommits(repo.repoPath)}
                    className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors mt-1"
                  >
                    {expandedCommits.has(repo.repoPath)
                      ? `${t('timeline.showLess') || 'Show less'}`
                      : `${t('timeline.showMore') || 'Show more'} (${repo.commits.length - DEFAULT_COMMITS_LIMIT} ${t('timeline.moreCommits') || 'more'})`
                    }
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {data?.timelines.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <HugeiconsIcon icon={Folder01Icon} className="h-10 w-10 text-muted-foreground/20 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">
              {t('timeline.noRepos') || 'No git repositories found in the selected scope.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
