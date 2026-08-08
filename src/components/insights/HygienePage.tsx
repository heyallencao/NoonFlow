'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/ui/metric-card';
import { CodebaseHeader } from './CodebaseHeader';
import { getWorkspaceName } from '@/lib/workspace-utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { SearchIcon } from '@hugeicons/core-free-icons';
import {
  AlertCircle,
  AlertTriangle,
  GitBranch,
  Info,
  RefreshCw,
  Settings2,
  TimerReset,
  Upload,
  Zap,
} from 'lucide-react';

type HygieneSeverity = 'info' | 'warning' | 'critical';

interface HygieneFinding {
  findingId: string;
  type: string;
  severity: HygieneSeverity;
  title: string;
  description: string;
  count?: number;
  linesChanged?: number;
  aheadCount?: number;
  behindCount?: number;
  workspacePath?: string;
  repoRoot?: string;
  actionLabel?: string;
  actionTarget?: string;
}

interface HygieneData {
  summary: {
    totalFindings: number;
    critical: number;
    warning: number;
  };
  findings: HygieneFinding[];
}

function getFindingScore(finding: HygieneFinding) {
  switch (finding.type) {
    case 'uncommitted-changes':
    case 'untracked-files':
    case 'stale-branches':
    case 'unpushed-commits':
      return finding.count ?? 0;
    case 'commit-risk':
      return finding.linesChanged ?? 0;
    case 'branch-diverged':
      return (finding.behindCount ?? 0) * 100 + (finding.aheadCount ?? 0);
    default:
      return 0;
  }
}

function sortFindings(left: HygieneFinding, right: HygieneFinding) {
  const scoreDiff = getFindingScore(right) - getFindingScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const leftName = getWorkspaceName(left.repoRoot || left.workspacePath || '');
  const rightName = getWorkspaceName(right.repoRoot || right.workspacePath || '');
  return leftName.localeCompare(rightName);
}

export default function HygienePage() {
  const { t } = useTranslation();
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const [data, setData] = useState<HygieneData | null>(null);
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

  const fetchHygiene = useCallback(async () => {
    if (activeWorkspaces.length === 0) {
      setLoading(false);
      setError(null);
      setData({ summary: { totalFindings: 0, critical: 0, warning: 0 }, findings: [] });
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const settled = await Promise.allSettled(
        activeWorkspaces.map(async (workspace) => {
          const res = await fetch(`/api/hygiene?workspace=${encodeURIComponent(workspace)}`);
          if (!res.ok) {
            throw new Error(`Failed to audit ${getWorkspaceName(workspace)}`);
          }

          return (await res.json()) as HygieneData;
        }),
      );

      const results = settled
        .filter((result): result is PromiseFulfilledResult<HygieneData> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failedCount = settled.length - results.length;

      if (results.length === 0) {
        throw new Error('Failed to audit all selected workspaces');
      }

      const merged: HygieneData = {
        summary: { totalFindings: 0, critical: 0, warning: 0 },
        findings: [],
      };

      for (const result of results) {
        merged.summary.totalFindings += result.summary?.totalFindings ?? 0;
        merged.summary.critical += result.summary?.critical ?? 0;
        merged.summary.warning += result.summary?.warning ?? 0;
        merged.findings.push(...(result.findings ?? []));
      }

      setData(merged);
      if (failedCount > 0) {
        setError(`Failed to audit ${failedCount} workspace${failedCount === 1 ? '' : 's'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaces]);

  useEffect(() => {
    void fetchHygiene();
  }, [fetchHygiene]);

  const criticalFindings = useMemo(
    () => (data?.findings.filter((finding) => finding.severity === 'critical').sort(sortFindings) ?? []),
    [data],
  );
  const warningFindings = useMemo(
    () => (data?.findings.filter((finding) => finding.severity === 'warning').sort(sortFindings) ?? []),
    [data],
  );
  const infoFindings = useMemo(
    () => (data?.findings.filter((finding) => finding.severity === 'info').sort(sortFindings) ?? []),
    [data],
  );

  if (activeWorkspaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-3xl bg-bg-secondary/40 px-8 py-10 shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-tertiary text-2xl">
            🛡️
          </div>
          <h3 className="text-xl font-semibold text-foreground">{t('hygiene.noWorkspaceTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('hygiene.noWorkspaceDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-6 text-foreground">
      <CodebaseHeader
        title={t('hygiene.title')}
        description={
          isAllWorkspaces
            ? `${t('hygiene.auditing')} ${activeWorkspaces.length} ${
                activeWorkspaces.length === 1 ? t('hygiene.workspace') : t('hygiene.workspaces')
              }`
            : `${t('hygiene.healthReport')} ${getWorkspaceName(effectiveSelectedWorkspace)}`
        }
        selectedWorkspace={effectiveSelectedWorkspace}
        onWorkspaceChange={setSelectedWorkspace}
        action={
          <button
            onClick={() => void fetchHygiene()}
            disabled={loading}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-xl bg-bg-secondary px-3 text-[12px] font-semibold text-foreground/85 shadow-sm transition-colors hover:bg-bg-hover disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
            {loading ? t('hygiene.refreshing') : t('common.refresh')}
          </button>
        }
      >
        <MetricCard
          variant="compact"
          label={t('hygiene.critical')}
          value={data?.summary.critical ?? 0}
          indicatorClassName="bg-rose-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('hygiene.warnings')}
          value={data?.summary.warning ?? 0}
          indicatorClassName="bg-amber-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
        <MetricCard
          variant="compact"
          label={t('hygiene.totalFindings')}
          value={data?.summary.totalFindings ?? 0}
          indicatorClassName="bg-sky-500"
          className="rounded-2xl border border-border-subtle/45 bg-bg-tertiary shadow-[var(--shadow-xl)]"
        />
      </CodebaseHeader>

      {error ? (
        <Alert variant="destructive" className="mb-6 rounded-2xl border-destructive/20 bg-destructive/5">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-[13px] font-bold">Audit Failed</AlertTitle>
          <AlertDescription className="text-[12px] opacity-80">{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : null}

      {data && data.findings.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-border-subtle/35 bg-bg-secondary p-14 text-center shadow-[var(--shadow-lg)]">
          <HugeiconsIcon icon={SearchIcon} className="mb-4 h-12 w-12 text-muted-foreground/20" />
          <h3 className="text-lg font-semibold text-foreground">{t('hygiene.pristineState')}</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {t('hygiene.pristineStateDesc')}
          </p>
        </div>
      ) : null}

      {data && data.findings.length > 0 ? (
        <div className="pb-12">
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/45">
              {t('hygiene.queueLabel')}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground/68">{t('hygiene.queueDescription')}</p>
          </div>

          <div className="space-y-6">
            <FindingSection
              title={t('hygiene.criticalIssues')}
              severity="critical"
              findings={criticalFindings}
            />
            <FindingSection
              title={t('hygiene.warnings')}
              severity="warning"
              findings={warningFindings}
            />
            <FindingSection
              title={t('hygiene.info')}
              severity="info"
              findings={infoFindings}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FindingSection({
  title,
  severity,
  findings,
}: {
  title: string;
  severity: HygieneSeverity;
  findings: HygieneFinding[];
}) {
  const severityStyles = {
    critical: {
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      textClassName: 'text-rose-400',
      badgeClassName: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
    },
    warning: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      textClassName: 'text-amber-400',
      badgeClassName: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    },
    info: {
      icon: <Info className="h-3.5 w-3.5" />,
      textClassName: 'text-sky-400',
      badgeClassName: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
    },
  } as const;

  const config = severityStyles[severity];

  if (findings.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-3 px-1">
        <div className={cn('flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]', config.textClassName)}>
          {config.icon}
          {title}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em]', config.badgeClassName)}>
          {findings.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {findings.map((finding) => (
          <FindingCard key={finding.findingId} finding={finding} />
        ))}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: HygieneFinding }) {
  const { t } = useTranslation();

  const repoName = getWorkspaceName(finding.repoRoot || finding.workspacePath || '');
  const scopeLabel = getWorkspaceName(finding.workspacePath || finding.repoRoot || '');

  const getTitle = () => {
    switch (finding.type) {
      case 'uncommitted-changes':
        return t('hygiene.findings.uncommittedChanges');
      case 'untracked-files':
        return t('hygiene.findings.untrackedFiles');
      case 'stale-branches':
        return t('hygiene.findings.staleBranches');
      case 'commit-risk':
        return t('hygiene.findings.commitRisk');
      case 'config-insight':
        return t('hygiene.findings.configInsight');
      case 'branch-diverged':
        return t('hygiene.findings.branchDiverged');
      case 'unpushed-commits':
        return t('hygiene.findings.unpushedCommits');
      default:
        return finding.title;
    }
  };

  const getDescription = () => {
    switch (finding.type) {
      case 'uncommitted-changes':
        return t('hygiene.findings.uncommittedChangesDesc', { count: finding.count ?? 0 });
      case 'untracked-files':
        return t('hygiene.findings.untrackedFilesDesc', { count: finding.count ?? 0 });
      case 'stale-branches':
        return t('hygiene.findings.staleBranchesDesc', { count: finding.count ?? 0 });
      case 'commit-risk':
        return t('hygiene.findings.commitRiskDesc', { count: finding.linesChanged ?? 0 });
      case 'config-insight':
        return t('hygiene.findings.configInsightDesc');
      case 'branch-diverged':
        return t('hygiene.findings.branchDivergedDesc', {
          ahead: finding.aheadCount ?? 0,
          behind: finding.behindCount ?? 0,
        });
      case 'unpushed-commits':
        return t('hygiene.findings.unpushedCommitsDesc', { count: finding.count ?? finding.aheadCount ?? 0 });
      default:
        return finding.description;
    }
  };

  const getIcon = () => {
    switch (finding.type) {
      case 'stale-branches':
        return <TimerReset className="h-4 w-4" />;
      case 'commit-risk':
        return <Zap className="h-4 w-4" />;
      case 'config-insight':
        return <Settings2 className="h-4 w-4" />;
      case 'branch-diverged':
        return <GitBranch className="h-4 w-4" />;
      case 'unpushed-commits':
        return <Upload className="h-4 w-4" />;
      case 'untracked-files':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const metricLabel =
    finding.type === 'commit-risk'
      ? `${finding.linesChanged ?? 0} lines`
      : finding.type === 'branch-diverged'
        ? `${finding.aheadCount ?? 0} / ${finding.behindCount ?? 0}`
        : typeof finding.count === 'number'
          ? `${finding.count}`
          : null;

  return (
    <Card className="overflow-hidden rounded-2xl border border-border-subtle/35 bg-bg-secondary px-0 py-0 shadow-[var(--shadow-lg)] transition-colors hover:bg-bg-tertiary">
      <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-primary text-foreground/78 shadow-sm">
            {getIcon()}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">{getTitle()}</h3>
              {repoName ? (
                <span className="rounded-full bg-bg-primary/65 px-2 py-0.5 text-[11px] font-medium text-foreground/65">
                  {repoName}
                </span>
              ) : null}
              {metricLabel ? (
                <span className="rounded-full bg-bg-primary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground/80">
                  {metricLabel}
                </span>
              ) : null}
            </div>

            <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground/82">{getDescription()}</p>

            {finding.repoRoot ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/52">
                {scopeLabel ? <span>{scopeLabel}</span> : null}
                <span className="font-mono text-muted-foreground/45">{finding.repoRoot}</span>
              </div>
            ) : null}
          </div>
        </div>

      </div>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: HygieneSeverity }) {
  const { t } = useTranslation();
  const variants = {
    critical: {
      className: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
      labelKey: 'hygiene.severity.critical' as const,
    },
    warning: {
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
      labelKey: 'hygiene.severity.warning' as const,
    },
    info: {
      className: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
      labelKey: 'hygiene.severity.info' as const,
    },
  };

  const config = variants[severity];

  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]', config.className)}>
      {t(config.labelKey)}
    </span>
  );
}
