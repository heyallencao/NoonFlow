'use client';

import { useEffect, useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useTranslation } from '@/hooks/useTranslation';
import type { ChildActivity, ChildActivityStatus } from '@/types';

const STATUS_CLASS: Record<ChildActivityStatus, string> = {
  running: 'bg-blue-400 text-blue-400',
  waiting: 'bg-amber-400 text-amber-400',
  completed: 'bg-emerald-400 text-emerald-400',
  failed: 'bg-red-400 text-red-400',
  stopped: 'bg-muted-foreground text-muted-foreground',
};

function formatDuration(startedAt: number, updatedAt: number, now: number): string {
  const end = Math.max(updatedAt, now);
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function ActivityPanel({ activities, hasActive }: { activities: ChildActivity[]; hasActive: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(hasActive);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasActive) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasActive]);

  const statusLabels = useMemo<Record<ChildActivityStatus, string>>(() => ({
    running: t('activity.status.running'),
    waiting: t('activity.status.waiting'),
    completed: t('activity.status.completed'),
    failed: t('activity.status.failed'),
    stopped: t('activity.status.stopped'),
  }), [t]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.025]"
      data-testid="child-activity-list"
    >
      <CollapsibleTrigger
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-foreground/[0.035]"
        data-testid="child-activity-trigger"
      >
        <span aria-hidden className={`text-[11px] transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="font-medium text-foreground/85">{t('activity.title')}</span>
        <span className="tabular-nums">{activities.length}</span>
        {hasActive && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-400" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y divide-border/45 border-t border-border/45" data-testid="child-activity-content">
          {activities.map((activity) => {
            const active = activity.status === 'running' || activity.status === 'waiting';
            return (
              <div
                key={activity.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-xs"
                data-testid="child-activity-row"
                data-activity-id={activity.id}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_CLASS[activity.status].split(' ')[0]}`} />
                  <span className="shrink-0 rounded bg-foreground/[0.055] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {activity.kind}
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground/90" title={activity.title}>
                    {activity.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 tabular-nums">
                  <span className={STATUS_CLASS[activity.status].split(' ')[1]}>{statusLabels[activity.status]}</span>
                  <span className="text-muted-foreground">
                    {formatDuration(activity.startedAt, activity.updatedAt, active ? now : activity.updatedAt)}
                  </span>
                </div>
                {activity.summary && (
                  <p className="col-span-2 min-w-0 break-words pl-3.5 leading-relaxed text-muted-foreground">
                    {activity.summary}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChildActivityList({ activities }: { activities: ChildActivity[] }) {
  if (activities.length === 0) return null;
  const hasActive = activities.some((item) => item.status === 'running' || item.status === 'waiting');
  // Remount only across active/terminal boundaries so the required automatic
  // open/fold behavior does not override a user's toggle within either phase.
  return <ActivityPanel key={hasActive ? 'active' : 'terminal'} activities={activities} hasActive={hasActive} />;
}
