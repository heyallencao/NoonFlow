'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, GitBranch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { type WidgetTelemetryThresholds, parseWidgetTelemetryThresholds } from '@/lib/widget-telemetry-thresholds';
import { safeFindings } from '@/lib/dashboard-alerts';
import { SETTING_KEYS } from '@/types';
import type { TranslationKey } from '@/i18n';

interface HygieneFinding {
  findingId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  count?: number;
  aheadCount?: number;
  behindCount?: number;
  repoRoot?: string;
}

interface HygieneResponse {
  summary: {
    totalFindings: number;
    critical: number;
    warning: number;
  };
  findings: HygieneFinding[];
}

async function fetchHygiene(workspace: string): Promise<HygieneResponse> {
  const res = await fetch(`/api/hygiene?workspace=${encodeURIComponent(workspace)}`);
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

async function fetchCombinedHygiene(workspaces: string[]): Promise<HygieneResponse | null> {
  if (workspaces.length === 0) {
    return null;
  }

  const settled = await Promise.allSettled(workspaces.map((workspace) => fetchHygiene(workspace)));
  const successful = settled
    .filter((result): result is PromiseFulfilledResult<HygieneResponse> => result.status === 'fulfilled')
    .map((result) => result.value);

  if (successful.length === 0) {
    return null;
  }

  return successful.reduce<HygieneResponse>((acc, current) => ({
    summary: {
      totalFindings: acc.summary.totalFindings + current.summary.totalFindings,
      critical: acc.summary.critical + current.summary.critical,
      warning: acc.summary.warning + current.summary.warning,
    },
    findings: [...acc.findings, ...current.findings],
  }), {
    summary: {
      totalFindings: 0,
      critical: 0,
      warning: 0,
    },
    findings: [],
  });
}

interface Alert {
  id: string;
  icon: React.ReactNode;
  toneClassName: string;
  text: string;
  href: string;
  priority: number;
}

interface WidgetTelemetryOverview {
  summary: {
    totalEvents: number;
    errorEvents: number;
  };
  byEvent: Array<{
    event: string;
    total: number;
    errors: number;
  }>;
  byCode: Array<{
    code: string;
    total: number;
  }>;
}

async function fetchWidgetTelemetry(days: number): Promise<WidgetTelemetryOverview> {
  const res = await fetch(`/api/widget/telemetry?days=${days}`);
  if (!res.ok) {
    throw new Error('Failed');
  }
  return res.json();
}

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function buildOverviewAlerts(input: {
  data: HygieneResponse | null | undefined;
  widgetData: WidgetTelemetryOverview | undefined;
  thresholds: WidgetTelemetryThresholds;
  t: TranslateFn;
}): Alert[] {
  const { data, widgetData, thresholds, t } = input;
  const findings = safeFindings<HygieneFinding>(data);
  const result: Alert[] = [];

  if (widgetData) {
    const totalEvents = widgetData.summary.totalEvents;
    if (totalEvents >= thresholds.minEvents) {
      const errorRate = totalEvents > 0 ? widgetData.summary.errorEvents / totalEvents : 0;
      const fallbackCount = widgetData.byCode.find((item) => item.code === 'W_RECOVER_TEXT_FALLBACK')?.total ?? 0;
      const fallbackRate = totalEvents > 0 ? fallbackCount / totalEvents : 0;
      const renderStat = widgetData.byEvent.find((item) => item.event === 'widget_render');
      const renderErrorRate = renderStat && renderStat.total > 0 ? renderStat.errors / renderStat.total : 0;

      const isCritical = (
        errorRate >= thresholds.errorRateCritical
        || fallbackRate >= thresholds.fallbackRateCritical
        || renderErrorRate >= thresholds.renderErrorRateCritical
      );
      const isWarning = (
        errorRate >= thresholds.errorRateWarning
        || fallbackRate >= thresholds.fallbackRateWarning
        || renderErrorRate >= thresholds.renderErrorRateWarning
      );

      if (isCritical || isWarning) {
        result.push({
          id: 'widget-telemetry',
          icon: <Activity className="h-4 w-4" />,
          toneClassName: isCritical
            ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
            : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
          text: isCritical
            ? t('dashboard.alerts.widgetCritical', {
              errorRate: `${(errorRate * 100).toFixed(1)}%`,
              fallbackRate: `${(fallbackRate * 100).toFixed(1)}%`,
              renderRate: `${(renderErrorRate * 100).toFixed(1)}%`,
            })
            : t('dashboard.alerts.widgetWarning', {
              errorRate: `${(errorRate * 100).toFixed(1)}%`,
              fallbackRate: `${(fallbackRate * 100).toFixed(1)}%`,
              renderRate: `${(renderErrorRate * 100).toFixed(1)}%`,
            }),
          href: '/widget-telemetry',
          priority: isCritical ? 110 : 95,
        });
      }
    }
  }

  if (!data) return result;

  const totalFindings = data.summary.totalFindings;
  if (totalFindings > 0) {
    result.push({
      id: 'hygiene',
      icon: <AlertTriangle className="h-4 w-4" />,
      toneClassName: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
      text: t('dashboard.alerts.hygieneIssues', { n: totalFindings }),
      href: '/hygiene',
      priority: 80,
    });
  }

  const uncommittedFindings = findings.filter((f) => f.type === 'uncommitted-changes');
  const topUncommitted = uncommittedFindings.reduce<HygieneFinding | null>((top, finding) => {
    if (!top) return finding;
    return (finding.count ?? 0) > (top.count ?? 0) ? finding : top;
  }, null);
  if (topUncommitted && (topUncommitted.count ?? 0) > 0) {
    const repoName = topUncommitted.repoRoot?.split('/').pop() ?? topUncommitted.repoRoot ?? 'repo';
    result.push({
      id: 'uncommitted',
      icon: <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-300 shrink-0" />,
      toneClassName: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
      text: t('dashboard.alerts.uncommittedFiles', {
        repo: repoName,
        n: topUncommitted.count ?? 0,
      }),
      href: '/hygiene',
      priority: 70,
    });
  }

  const divergedFindings = findings.filter((f) => f.type === 'branch-diverged');
  const topDiverged = divergedFindings.reduce<HygieneFinding | null>((top, finding) => {
    if (!top) return finding;
    return (finding.behindCount ?? 0) > (top.behindCount ?? 0) ? finding : top;
  }, null);
  if (topDiverged && ((topDiverged.aheadCount ?? 0) > 0 || (topDiverged.behindCount ?? 0) > 0)) {
    const repoName = topDiverged.repoRoot?.split('/').pop() ?? topDiverged.repoRoot ?? 'repo';
    result.push({
      id: 'branch-diverged',
      icon: <GitBranch className="h-4 w-4" />,
      toneClassName: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
      text: t('dashboard.alerts.branchDiverged', {
        repo: repoName,
        ahead: topDiverged.aheadCount ?? 0,
        behind: topDiverged.behindCount ?? 0,
      }),
      href: '/hygiene',
      priority: 90,
    });
  }

  return result.sort((left, right) => right.priority - left.priority);
}

export function AlertsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const workspacePaths = useWorkspaceStore((s) => s.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);
  const appSettingsQuery = useAppSettingsQuery();
  const visibleWorkspaces = useMemo(
    () => workspacePaths.filter((workspace) => !hiddenWorkspaces.includes(workspace)),
    [hiddenWorkspaces, workspacePaths],
  );
  const thresholds = useMemo(
    () => parseWidgetTelemetryThresholds(appSettingsQuery.data?.settings?.[SETTING_KEYS.WIDGET_TELEMETRY_THRESHOLDS]),
    [appSettingsQuery.data?.settings],
  );

  const { data } = useQuery({
    queryKey: ['overview-hygiene', visibleWorkspaces],
    queryFn: () => fetchCombinedHygiene(visibleWorkspaces),
    enabled: visibleWorkspaces.length > 0,
  });
  const { data: widgetData } = useQuery({
    queryKey: ['overview-widget-telemetry', 7],
    queryFn: () => fetchWidgetTelemetry(7),
  });

  const alerts = useMemo<Alert[]>(
    () => buildOverviewAlerts({ data, widgetData, thresholds, t }),
    [data, t, thresholds, widgetData],
  );

  if (alerts.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-bg-secondary shadow-sm">
      <div className="px-4 pt-3 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
          {t('dashboard.alerts.needsAttention')}
        </p>
      </div>
      {alerts.map((alert, i) => (
        <button
          key={alert.id}
          onClick={() => router.push(alert.href)}
          className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-tertiary/60 ${
            i < alerts.length - 1 ? 'shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]' : ''
          }`}
        >
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
              alert.toneClassName,
            )}
          >
            {alert.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] leading-5 text-sidebar-foreground/82">{alert.text}</span>
          </span>
          <OverviewActionArrow className="mt-1" />
        </button>
      ))}
    </div>
  );
}
