'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { CodebaseHeader } from './CodebaseHeader';
import { MetricCard } from '@/components/ui/metric-card';
import { getWorkspaceName } from '@/lib/workspace-utils';
import { toLocalDateKey } from '@/lib/date-key';
import { cn } from '@/lib/utils';
import {
  interactiveBarChartClassName,
  MetricChartTooltip,
  sharedChartTooltipProps,
} from '@/components/ui/chart-tooltip';
import { useSearchParams } from 'next/navigation';

interface CommitActivity {
  date: string;
  count: number;
}

interface RepoCommits {
  repoName: string;
  repoPath: string;
  commitCount: number;
}

interface UncommittedFile {
  path: string;
  status: string;
  repoName: string;
}

interface FeatureBranch {
  name: string;
  repoName: string;
  description: string;
  lastCommit?: {
    message: string;
    author: string;
    date: string;
  };
}

interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  status: string;
  lastActivity: string;
}

interface WorkGraphData {
  commitActivity: CommitActivity[];
  repoCommits: RepoCommits[];
  uncommittedWork: UncommittedFile[];
  uncommittedWorkTotal?: number;
  uncommittedWorkTruncated?: boolean;
  featureBranches: FeatureBranch[];
  featureBranchesTotal?: number;
  featureBranchesTruncated?: boolean;
  allRepos: RepoInfo[];
}

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

async function fetchWorkGraph(
  workspaces: string[],
  days: number,
  loadFailedMessage: string,
  repoPath?: string | null,
): Promise<WorkGraphData> {
  if (workspaces.length === 0) {
    return {
      commitActivity: [],
      repoCommits: [],
      uncommittedWork: [],
      featureBranches: [],
      allRepos: [],
    };
  }
  // Fetch from all workspaces and merge results
  const results = await Promise.all(
    workspaces.map(async (workspace) => {
      const params = new URLSearchParams({
        workspace,
        days: String(days),
      });
      if (repoPath) {
        params.set('repo', repoPath);
      }
      const res = await fetch(`/api/work-graph?${params.toString()}`);
      if (!res.ok) {
        throw new Error(loadFailedMessage);
      }
      return res.json();
    })
  );

  // Merge results
  const merged: WorkGraphData = {
    commitActivity: [],
    repoCommits: [],
    uncommittedWork: [],
    uncommittedWorkTotal: 0,
    featureBranches: [],
    featureBranchesTotal: 0,
    allRepos: [],
  };

  for (const result of results) {
    // Merge commit activity (aggregate by date)
    for (const activity of result.commitActivity || []) {
      const existing = merged.commitActivity.find(a => a.date === activity.date);
      if (existing) {
        existing.count += activity.count;
      } else {
        merged.commitActivity.push({ ...activity });
      }
    }
    // Merge repo commits
    merged.repoCommits.push(...(result.repoCommits || []));
    // Merge uncommitted work
    merged.uncommittedWork.push(...(result.uncommittedWork || []));
    merged.uncommittedWorkTotal = (merged.uncommittedWorkTotal || 0) + (result.uncommittedWorkTotal || 0);
    // Merge feature branches
    merged.featureBranches.push(...(result.featureBranches || []));
    merged.featureBranchesTotal = (merged.featureBranchesTotal || 0) + (result.featureBranchesTotal || 0);
    // Merge repos
    merged.allRepos.push(...(result.allRepos || []));
  }

  return merged;
}

export default function WorkGraphPage() {
  const { t } = useTranslation();
  const loadFailedMessage = t('insights.loadFailed');
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const searchParams = useSearchParams();
  const days = 30;
  const requestedWorkspace = searchParams.get('workspace');
  const requestedRepoPath = searchParams.get('repo');

  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);

  useEffect(() => {
    setSelectedWorkspace(requestedWorkspace || null);
  }, [requestedWorkspace]);

  const effectiveSelectedWorkspace = useMemo(
    () => (selectedWorkspace && workspacePaths.includes(selectedWorkspace) ? selectedWorkspace : null),
    [selectedWorkspace, workspacePaths]
  );
  const isAllWorkspaces = effectiveSelectedWorkspace === null;
  const effectiveRepoPath = useMemo(() => {
    if (!requestedRepoPath) return null;
    if (!effectiveSelectedWorkspace) return requestedRepoPath;
    return (
      requestedRepoPath === effectiveSelectedWorkspace ||
      requestedRepoPath.startsWith(`${effectiveSelectedWorkspace}/`)
    )
      ? requestedRepoPath
      : null;
  }, [effectiveSelectedWorkspace, requestedRepoPath]);

  const activeWorkspaces = useMemo(() => {
    if (!effectiveSelectedWorkspace) {
      return workspacePaths;
    }
    return [effectiveSelectedWorkspace];
  }, [effectiveSelectedWorkspace, workspacePaths]);

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ['work-graph', activeWorkspaces, days, effectiveRepoPath],
    queryFn: async () => {
      return fetchWorkGraph(activeWorkspaces, days, loadFailedMessage, effectiveRepoPath);
    },
    enabled: activeWorkspaces.length > 0,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const focusedRepoName = useMemo(
    () => (effectiveRepoPath ? getWorkspaceName(effectiveRepoPath) : null),
    [effectiveRepoPath]
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'modified': return 'text-amber-500';
      case 'added': return 'text-emerald-500';
      case 'deleted': return 'text-rose-500';
      case 'renamed': return 'text-blue-500';
      case 'untracked': return 'text-muted-foreground/60';
      default: return 'text-muted-foreground/60';
    }
  };

  const commitActivity30d = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.commitActivity.map(d => [d.date, d.count]));
    const result: Array<{ date: string; name: string; value: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateKey(d);
      result.push({
        date: dateStr,
        name: monthDayFormatter.format(parseLocalDate(dateStr)),
        value: map.get(dateStr) || 0,
      });
    }
    return result;
  }, [data]);

  if (activeWorkspaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="h-16 w-16 rounded-2xl bg-bg-tertiary flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">📊</span>
          </div>
          <h3 className="text-lg font-bold text-foreground">{t('workgraph.noWorkspace') || 'No Workspace Selected'}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('workgraph.noWorkspaceDesc') || 'Select a workspace to view your activity graph.'}</p>
        </div>
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : loadFailedMessage;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <span className="text-destructive text-lg">!</span>
          </div>
          <div className="text-sm font-semibold text-foreground">{message}</div>
          <Button size="sm" onClick={() => void refetch()} disabled={isFetching} variant="outline" className="mt-2">
            {t('error.tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  const commitYAxisMax = Math.max(...commitActivity30d.map(d => d.value), 5);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 bg-background text-foreground">
      <CodebaseHeader
        title={t('workgraph.title') || 'Work Graph'}
        count={data?.allRepos.length}
        description={
          effectiveRepoPath
            ? `${t('workgraph.deepDive') || 'Deep dive into'} ${focusedRepoName}`
            : isAllWorkspaces
              ? `${t('workgraph.trackingActivity') || 'Tracking activity across'} ${activeWorkspaces.length} ${activeWorkspaces.length === 1 ? (t('workgraph.workspace') || 'workspace') : (t('workgraph.workspaces') || 'workspaces')}`
              : `${t('workgraph.deepDive') || 'Deep dive into'} ${getWorkspaceName(effectiveSelectedWorkspace)}`
        }
        selectedWorkspace={effectiveSelectedWorkspace}
        onWorkspaceChange={setSelectedWorkspace}
        action={
          <Button
            onClick={() => void refetch()}
            variant="outline"
            size="sm"
            disabled={isFetching}
            className="h-8 rounded-lg text-[12px] font-semibold"
          >
            {isFetching ? (t('workgraph.refreshing') || '...') : t('common.refresh') || 'Refresh'}
          </Button>
        }
      >
        <MetricCard
          variant="compact"
          label={t('workgraph.uncommitted') || 'Uncommitted'}
          value={data?.uncommittedWorkTotal || data?.uncommittedWork.length || 0}
          indicatorClassName="bg-amber-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('workgraph.featureBranches') || 'Feature Branches'}
          value={data?.featureBranchesTotal || data?.featureBranches.length || 0}
          indicatorClassName="bg-blue-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('workgraph.repositories') || 'Repositories'}
          value={data?.allRepos.length || 0}
          indicatorClassName="bg-emerald-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
      </CodebaseHeader>

      <div className="space-y-6 pb-12">
        <Card className="border border-border-subtle/35 bg-card p-6 shadow-[var(--shadow-xl)]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70">{t('workgraph.commitActivity') || 'Commit Activity'}</h2>
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">{t('workgraph.last30Days') || 'Last 30 days cumulative'}</p>
            </div>
            <Badge variant="outline" className="bg-bg-secondary/80 text-[10px] font-bold uppercase tracking-tighter">{t('workgraph.30dTrend') || '30D Trend'}</Badge>
          </div>
          <div className="h-[160px] lg:h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart className={interactiveBarChartClassName} data={commitActivity30d}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fontWeight: 600, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis hide domain={[0, commitYAxisMax]} />
                <Tooltip
                  {...sharedChartTooltipProps}
                  content={(props) => (
                    <MetricChartTooltip
                      {...props}
                      getTitle={(entry) => String(entry.name ?? '')}
                      getValue={(entry) => `${entry.value ?? 0} ${t('workgraph.commits') || 'commits'}`}
                    />
                  )}
                />
                <Bar
                  activeBar={true}
                  dataKey="value"
                  fill="var(--chart-blue)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border border-border-subtle/35 bg-card p-6 shadow-[var(--shadow-xl)]">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70 mb-4">{t('workgraph.uncommittedWork') || 'Uncommitted Work'}</h2>
            <div className="space-y-3">
              {data?.uncommittedWork.slice(0, 6).map((file, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn("font-mono text-[10px] font-bold w-4", getStatusColor(file.status))}>
                      {file.status.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-[13px] font-medium text-foreground/80 truncate">{file.path}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/40 font-mono group-hover:text-muted-foreground/60 transition-colors">
                    {file.repoName}
                  </span>
                </div>
              ))}
              {(!data?.uncommittedWork || data.uncommittedWork.length === 0) && (
                <p className="text-sm text-muted-foreground/50 py-4 text-center">{t('workgraph.cleanSlate') || 'Clean slate. No pending changes.'}</p>
              )}
            </div>
          </Card>

          <Card className="border border-border-subtle/35 bg-card p-6 shadow-[var(--shadow-xl)]">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70 mb-4">{t('workgraph.activeBranches') || 'Active Branches'}</h2>
            <div className="space-y-3">
              {data?.featureBranches.slice(0, 6).map((branch, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-bold text-foreground/90 truncate">{branch.name}</span>
                    <span className="text-[11px] text-muted-foreground/60 truncate">{branch.repoName}</span>
                  </div>
                  {branch.lastCommit && (
                    <span className="text-[10px] text-muted-foreground/40 font-medium whitespace-nowrap ml-4">
                      {new Date(branch.lastCommit.date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
              {(!data?.featureBranches || data.featureBranches.length === 0) && (
                <p className="text-sm text-muted-foreground/50 py-4 text-center">{t('workgraph.noActiveBranches') || 'No active feature branches found.'}</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
