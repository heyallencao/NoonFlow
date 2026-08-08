'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, LoaderCircle, ShieldCheck, Workflow } from 'lucide-react';

import { MonitorRangePicker, type MonitorRangeDays } from '@/components/insights/MonitorRangePicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MetricCard } from '@/components/ui/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { queryKeys } from '@/lib/queries/query-keys';
import {
  normalizeWidgetTelemetryThresholds,
  parseWidgetTelemetryThresholds,
  serializeWidgetTelemetryThresholds,
  type WidgetTelemetryThresholds,
} from '@/lib/widget-telemetry-thresholds';
import { parseTelemetryCreatedAt } from '@/lib/widget-telemetry-time';
import { cn } from '@/lib/utils';
import { SETTING_KEYS } from '@/types';

interface WidgetTelemetryStats {
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
  recent: Array<{
    event: string;
    ok: boolean;
    code: string;
    runtime: string;
    sessionId: string | null;
    messageId: string;
    traceId: string;
    schemaVersion: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

type HealthLevel = 'healthy' | 'warning' | 'critical' | 'no_data';
type AlertLevel = 'info' | 'warning' | 'critical';

interface WidgetHealthAlert {
  id: string;
  level: AlertLevel;
  title: string;
  action: string;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatPercent(value: number, digits: number = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatWidgetEventName(value: string): string {
  return value
    .replace(/^widget_/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCompactDateTime(value: string): string {
  const parsed = parseTelemetryCreatedAt(value);
  if (!parsed) {
    return value;
  }
  return parsed.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function safeRate(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return part / total;
}

function getWidgetHealth(
  stats: WidgetTelemetryStats | undefined,
  thresholds: WidgetTelemetryThresholds,
): {
  level: HealthLevel;
  errorRate: number;
  fallbackRate: number;
  renderErrorRate: number;
} {
  const totalEvents = stats?.summary.totalEvents ?? 0;
  const errorEvents = stats?.summary.errorEvents ?? 0;
  const byCode = stats?.byCode ?? [];
  const byEvent = stats?.byEvent ?? [];
  const fallbackCount = byCode.find((item) => item.code === 'W_RECOVER_TEXT_FALLBACK')?.total ?? 0;
  const renderStat = byEvent.find((item) => item.event === 'widget_render');
  const errorRate = safeRate(errorEvents, totalEvents);
  const fallbackRate = safeRate(fallbackCount, totalEvents);
  const renderErrorRate = safeRate(renderStat?.errors ?? 0, renderStat?.total ?? 0);

  if (totalEvents < thresholds.minEvents) {
    return {
      level: 'no_data',
      errorRate,
      fallbackRate,
      renderErrorRate,
    };
  }

  if (
    errorRate >= thresholds.errorRateCritical
    || fallbackRate >= thresholds.fallbackRateCritical
    || renderErrorRate >= thresholds.renderErrorRateCritical
  ) {
    return { level: 'critical', errorRate, fallbackRate, renderErrorRate };
  }
  if (
    errorRate >= thresholds.errorRateWarning
    || fallbackRate >= thresholds.fallbackRateWarning
    || renderErrorRate >= thresholds.renderErrorRateWarning
  ) {
    return { level: 'warning', errorRate, fallbackRate, renderErrorRate };
  }
  return { level: 'healthy', errorRate, fallbackRate, renderErrorRate };
}

function getHealthBadgeVariant(level: HealthLevel): 'success' | 'warning' | 'destructive' | 'outline' {
  if (level === 'critical') return 'destructive';
  if (level === 'warning') return 'warning';
  if (level === 'healthy') return 'success';
  return 'outline';
}

function getHealthToneClass(level: HealthLevel): string {
  if (level === 'critical') return 'text-red-600 dark:text-red-300';
  if (level === 'warning') return 'text-amber-600 dark:text-amber-300';
  if (level === 'healthy') return 'text-emerald-600 dark:text-emerald-300';
  return 'text-muted-foreground';
}

function getAlertBadgeVariant(level: AlertLevel): 'outline' | 'warning' | 'destructive' {
  if (level === 'critical') return 'destructive';
  if (level === 'warning') return 'warning';
  return 'outline';
}

async function fetchWidgetTelemetryStats(days: MonitorRangeDays): Promise<WidgetTelemetryStats> {
  const res = await fetch(`/api/widget/telemetry?days=${days}`);
  if (!res.ok) {
    throw new Error('Failed to fetch widget telemetry stats');
  }
  return res.json();
}

function toRateInputValue(value: number): string {
  return (value * 100).toFixed(1);
}

function parseRateInputValue(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(parsed / 100, 1));
}

function TrendListRow({
  label,
  sublabel,
  value,
  maxValue,
  toneClassName,
}: {
  label: string;
  sublabel?: string;
  value: number;
  maxValue: number;
  toneClassName?: string;
}) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, value > 0 ? 5 : 0) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {sublabel ? <p className="truncate text-xs text-muted-foreground">{sublabel}</p> : null}
        </div>
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatNumber(value)}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sidebar-border/45">
        <div
          className={cn('h-full rounded-full bg-[var(--chart-blue)]', toneClassName)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export default function WidgetTelemetryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<MonitorRangeDays>(14);
  const appSettingsQuery = useAppSettingsQuery();
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdDirty, setThresholdDirty] = useState(false);
  const [thresholdForm, setThresholdForm] = useState({
    minEvents: '20',
    errorRateWarning: '6.0',
    errorRateCritical: '15.0',
    fallbackRateWarning: '3.0',
    fallbackRateCritical: '8.0',
    renderErrorRateWarning: '8.0',
    renderErrorRateCritical: '18.0',
  });

  const activeThresholds = useMemo(
    () =>
      parseWidgetTelemetryThresholds(
        appSettingsQuery.data?.settings?.[SETTING_KEYS.WIDGET_TELEMETRY_THRESHOLDS],
      ),
    [appSettingsQuery.data?.settings],
  );

  useEffect(() => {
    setThresholdForm({
      minEvents: String(activeThresholds.minEvents),
      errorRateWarning: toRateInputValue(activeThresholds.errorRateWarning),
      errorRateCritical: toRateInputValue(activeThresholds.errorRateCritical),
      fallbackRateWarning: toRateInputValue(activeThresholds.fallbackRateWarning),
      fallbackRateCritical: toRateInputValue(activeThresholds.fallbackRateCritical),
      renderErrorRateWarning: toRateInputValue(activeThresholds.renderErrorRateWarning),
      renderErrorRateCritical: toRateInputValue(activeThresholds.renderErrorRateCritical),
    });
    setThresholdDirty(false);
  }, [activeThresholds]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['widget-telemetry-stats', range],
    queryFn: () => fetchWidgetTelemetryStats(range),
    placeholderData: (previousData) => previousData,
  });

  const byEvent = useMemo(() => (data?.byEvent ?? []).slice(0, 8), [data?.byEvent]);
  const byCode = useMemo(() => (data?.byCode ?? []).slice(0, 8), [data?.byCode]);
  const recent = useMemo(() => (data?.recent ?? []).slice(0, 12), [data?.recent]);
  const maxEventCount = Math.max(...byEvent.map((item) => item.total), 1);
  const maxCodeCount = Math.max(...byCode.map((item) => item.total), 1);

  const health = useMemo(() => getWidgetHealth(data, activeThresholds), [data, activeThresholds]);
  const totalEvents = data?.summary.totalEvents ?? 0;
  const errorEvents = data?.summary.errorEvents ?? 0;
  const successRate = totalEvents > 0 ? 1 - safeRate(errorEvents, totalEvents) : 0;

  const updateThresholdField = (key: keyof typeof thresholdForm, value: string) => {
    setThresholdForm((previous) => ({
      ...previous,
      [key]: value,
    }));
    setThresholdDirty(true);
  };

  const resetThresholdForm = () => {
    setThresholdForm({
      minEvents: String(activeThresholds.minEvents),
      errorRateWarning: toRateInputValue(activeThresholds.errorRateWarning),
      errorRateCritical: toRateInputValue(activeThresholds.errorRateCritical),
      fallbackRateWarning: toRateInputValue(activeThresholds.fallbackRateWarning),
      fallbackRateCritical: toRateInputValue(activeThresholds.fallbackRateCritical),
      renderErrorRateWarning: toRateInputValue(activeThresholds.renderErrorRateWarning),
      renderErrorRateCritical: toRateInputValue(activeThresholds.renderErrorRateCritical),
    });
    setThresholdDirty(false);
  };

  const saveThresholdForm = async () => {
    const normalized = normalizeWidgetTelemetryThresholds({
      minEvents: Number(thresholdForm.minEvents),
      errorRateWarning: parseRateInputValue(thresholdForm.errorRateWarning, activeThresholds.errorRateWarning),
      errorRateCritical: parseRateInputValue(thresholdForm.errorRateCritical, activeThresholds.errorRateCritical),
      fallbackRateWarning: parseRateInputValue(thresholdForm.fallbackRateWarning, activeThresholds.fallbackRateWarning),
      fallbackRateCritical: parseRateInputValue(thresholdForm.fallbackRateCritical, activeThresholds.fallbackRateCritical),
      renderErrorRateWarning: parseRateInputValue(thresholdForm.renderErrorRateWarning, activeThresholds.renderErrorRateWarning),
      renderErrorRateCritical: parseRateInputValue(thresholdForm.renderErrorRateCritical, activeThresholds.renderErrorRateCritical),
    });
    const serialized = serializeWidgetTelemetryThresholds(normalized);

    setThresholdSaving(true);
    try {
      const res = await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            [SETTING_KEYS.WIDGET_TELEMETRY_THRESHOLDS]: serialized,
          },
        }),
      });
      if (!res.ok) {
        return;
      }

      queryClient.setQueryData(
        queryKeys.appSettings(),
        (current: { settings?: Record<string, string> } | undefined) => ({
          settings: {
            ...(current?.settings || {}),
            [SETTING_KEYS.WIDGET_TELEMETRY_THRESHOLDS]: serialized,
          },
        }),
      );
      setThresholdDirty(false);
    } finally {
      setThresholdSaving(false);
    }
  };

  const healthLabel =
    health.level === 'critical'
      ? t('widgetTelemetry.statusCritical')
      : health.level === 'warning'
        ? t('widgetTelemetry.statusWarning')
        : health.level === 'healthy'
          ? t('widgetTelemetry.statusHealthy')
          : t('widgetTelemetry.statusNoData');

  const healthSummary =
    health.level === 'critical'
      ? t('widgetTelemetry.healthCritical')
      : health.level === 'warning'
        ? t('widgetTelemetry.healthWarning')
        : health.level === 'healthy'
          ? t('widgetTelemetry.healthHealthy')
          : t('widgetTelemetry.healthNoData');

  const healthAlerts = useMemo<WidgetHealthAlert[]>(() => {
    const total = data?.summary.totalEvents ?? 0;
    if (total < activeThresholds.minEvents) {
      return [
        {
          id: 'min-samples',
          level: 'info',
          title: t('widgetTelemetry.alertsMinSamples', {
            total,
            min: activeThresholds.minEvents,
          }),
          action: t('widgetTelemetry.alertsActionMinSamples'),
        },
      ];
    }

    const alerts: WidgetHealthAlert[] = [];
    const addAlert = (
      id: string,
      value: number,
      warningThreshold: number,
      criticalThreshold: number,
      titleKey: 'widgetTelemetry.alertsErrorRate' | 'widgetTelemetry.alertsFallbackRate' | 'widgetTelemetry.alertsRenderRate',
      actionKey: 'widgetTelemetry.alertsActionErrorRate' | 'widgetTelemetry.alertsActionFallback' | 'widgetTelemetry.alertsActionRender',
    ) => {
      let level: AlertLevel | null = null;
      let threshold = 0;
      if (value >= criticalThreshold) {
        level = 'critical';
        threshold = criticalThreshold;
      } else if (value >= warningThreshold) {
        level = 'warning';
        threshold = warningThreshold;
      }
      if (!level) return;

      alerts.push({
        id,
        level,
        title: t(titleKey, {
          value: formatPercent(value),
          threshold: formatPercent(threshold),
        }),
        action: t(actionKey),
      });
    };

    addAlert(
      'error-rate',
      health.errorRate,
      activeThresholds.errorRateWarning,
      activeThresholds.errorRateCritical,
      'widgetTelemetry.alertsErrorRate',
      'widgetTelemetry.alertsActionErrorRate',
    );
    addAlert(
      'fallback-rate',
      health.fallbackRate,
      activeThresholds.fallbackRateWarning,
      activeThresholds.fallbackRateCritical,
      'widgetTelemetry.alertsFallbackRate',
      'widgetTelemetry.alertsActionFallback',
    );
    addAlert(
      'render-error-rate',
      health.renderErrorRate,
      activeThresholds.renderErrorRateWarning,
      activeThresholds.renderErrorRateCritical,
      'widgetTelemetry.alertsRenderRate',
      'widgetTelemetry.alertsActionRender',
    );

    return alerts;
  }, [activeThresholds, data?.summary.totalEvents, health.errorRate, health.fallbackRate, health.renderErrorRate, t]);

  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-red-500">{t('widgetTelemetry.error') || '加载 Widget 遥测统计失败'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5 lg:mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {t('nav.widgetTelemetry') || 'Widget Telemetry'}
            {isFetching ? <LoaderCircle className="ml-2 inline-block h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t('widgetTelemetry.description') || 'Generative UI parse/compile/render/recover observability and health.'}
          </p>
        </div>
        <MonitorRangePicker value={range} onChange={setRange} />
      </div>

      <Card className="mb-4 border-border-subtle/70">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('widgetTelemetry.healthTitle') || 'Health Signal'}
              </p>
              <p className={cn('mt-1 text-sm font-medium', getHealthToneClass(health.level))}>{healthSummary}</p>
            </div>
            <Badge variant={getHealthBadgeVariant(health.level)}>{healthLabel}</Badge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <p>
              {t('tools.errorRate') || 'Error rate'}: <span className="font-medium text-foreground">{formatPercent(health.errorRate)}</span>
            </p>
            <p>
              {t('widgetTelemetry.fallbackRate') || 'Fallback rate'}: <span className="font-medium text-foreground">{formatPercent(health.fallbackRate)}</span>
            </p>
            <p>
              {t('widgetTelemetry.renderErrorRate') || 'Render error rate'}:{' '}
              <span className="font-medium text-foreground">{formatPercent(health.renderErrorRate)}</span>
            </p>
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>
              {t('widgetTelemetry.thresholdCriticalLabel') || 'Critical'}:{' '}
              {formatPercent(activeThresholds.errorRateCritical)} / {formatPercent(activeThresholds.fallbackRateCritical)} / {formatPercent(activeThresholds.renderErrorRateCritical)}
            </p>
            <p>
              {t('widgetTelemetry.thresholdWarningLabel') || 'Warning'}:{' '}
              {formatPercent(activeThresholds.errorRateWarning)} / {formatPercent(activeThresholds.fallbackRateWarning)} / {formatPercent(activeThresholds.renderErrorRateWarning)}
            </p>
            <p>
              {t('widgetTelemetry.thresholdMinSamplesLabel') || 'Min samples'}: {activeThresholds.minEvents}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4 border-border-subtle/70">
        <CardHeader>
          <CardTitle className="text-xs font-semibold">
            {t('widgetTelemetry.alertsTitle') || 'Triggered Alerts'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('widgetTelemetry.alertsNoIssues') || 'No active threshold alerts in current window.'}
            </p>
          ) : (
            <div className="space-y-2">
              {healthAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-md border border-border-subtle/70 bg-bg-tertiary/25 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{alert.title}</p>
                    <Badge variant={getAlertBadgeVariant(alert.level)}>
                      {alert.level === 'critical'
                        ? (t('widgetTelemetry.levelCritical') || 'Critical')
                        : alert.level === 'warning'
                          ? (t('widgetTelemetry.levelWarning') || 'Warning')
                          : (t('widgetTelemetry.levelInfo') || 'Info')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{alert.action}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4 border-border-subtle/70">
        <CardHeader>
          <CardTitle className="text-xs font-semibold">
            {t('widgetTelemetry.thresholdConfigTitle') || 'Alert Thresholds'}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('widgetTelemetry.thresholdConfigDesc') || 'Configure warning/critical trigger points used by health classification.'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdMinEvents') || 'Min Events'}</p>
              <Input
                type="number"
                min={1}
                step={1}
                value={thresholdForm.minEvents}
                onChange={(event) => updateThresholdField('minEvents', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdErrorWarning') || 'Error Warning %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.errorRateWarning}
                onChange={(event) => updateThresholdField('errorRateWarning', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdErrorCritical') || 'Error Critical %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.errorRateCritical}
                onChange={(event) => updateThresholdField('errorRateCritical', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdFallbackWarning') || 'Fallback Warning %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.fallbackRateWarning}
                onChange={(event) => updateThresholdField('fallbackRateWarning', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdFallbackCritical') || 'Fallback Critical %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.fallbackRateCritical}
                onChange={(event) => updateThresholdField('fallbackRateCritical', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdRenderWarning') || 'Render Warning %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.renderErrorRateWarning}
                onChange={(event) => updateThresholdField('renderErrorRateWarning', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">{t('widgetTelemetry.thresholdRenderCritical') || 'Render Critical %'}</p>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={thresholdForm.renderErrorRateCritical}
                onChange={(event) => updateThresholdField('renderErrorRateCritical', event.target.value)}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetThresholdForm}
              disabled={!thresholdDirty || thresholdSaving}
            >
              {t('widgetTelemetry.thresholdReset') || 'Reset'}
            </Button>
            <Button
              size="sm"
              onClick={saveThresholdForm}
              disabled={!thresholdDirty || thresholdSaving}
            >
              {thresholdSaving
                ? (t('widgetTelemetry.thresholdSaving') || 'Saving...')
                : (t('widgetTelemetry.thresholdSave') || 'Save thresholds')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5 sm:gap-3 lg:gap-3.5">
        <MetricCard
          variant="compact"
          label={t('widgetTelemetry.totalEvents') || 'Total Events'}
          value={formatNumber(totalEvents)}
          indicatorClassName="bg-violet-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('widgetTelemetry.errorEvents') || 'Error Events'}
          value={formatNumber(errorEvents)}
          indicatorClassName="bg-rose-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('widgetTelemetry.successRate') || 'Success Rate'}
          value={formatPercent(successRate)}
          indicatorClassName="bg-emerald-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('widgetTelemetry.fallbackRate') || 'Fallback Rate'}
          value={formatPercent(health.fallbackRate)}
          indicatorClassName="bg-amber-400"
          loading={isLoading}
        />
        <MetricCard
          variant="compact"
          label={t('widgetTelemetry.renderErrorRate') || 'Render Error Rate'}
          value={formatPercent(health.renderErrorRate)}
          indicatorClassName="bg-cyan-400"
          loading={isLoading}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              {t('widgetTelemetry.eventsByType') || 'Events by Type'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : byEvent.length === 0 ? (
              <EmptyState icon={<Activity className="h-5 w-5" />} title={t('widgetTelemetry.noData') || '暂无数据'} className="py-10" />
            ) : (
              <div className="space-y-4">
                {byEvent.map((item) => (
                  <TrendListRow
                    key={item.event}
                    label={formatWidgetEventName(item.event)}
                    sublabel={t('widgetTelemetry.eventErrors', {
                      errors: formatNumber(item.errors),
                      rate: formatPercent(safeRate(item.errors, item.total)),
                    })}
                    value={item.total}
                    maxValue={maxEventCount}
                    toneClassName="bg-[var(--chart-blue)]"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
              {t('widgetTelemetry.errorsByCode') || 'Errors by Code'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : byCode.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle className="h-5 w-5" />}
                title={t('widgetTelemetry.noErrors') || 'No widget errors in selected range'}
                className="py-10"
              />
            ) : (
              <div className="space-y-4">
                {byCode.map((item) => (
                  <TrendListRow
                    key={item.code}
                    label={item.code}
                    value={item.total}
                    maxValue={maxCodeCount}
                    toneClassName="bg-[var(--chart-rose)]"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs font-semibold">
            <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
            {t('widgetTelemetry.recentEvents') || 'Recent Events'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : recent.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title={t('widgetTelemetry.noData') || '暂无数据'} className="py-10" />
          ) : (
            <div className="space-y-2">
              {recent.map((item) => (
                <div
                  key={`${item.traceId}-${item.createdAt}-${item.event}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle/70 bg-bg-tertiary/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{formatWidgetEventName(item.event)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.code || (item.ok ? 'OK' : 'ERROR')} · {item.traceId || '-'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.ok ? 'success' : 'destructive'}>{item.ok ? 'OK' : 'ERROR'}</Badge>
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatCompactDateTime(item.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
