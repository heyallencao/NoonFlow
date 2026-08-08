'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';

interface SettingsResponse {
  settings: {
    hooks?: Record<string, unknown>;
    allowedTools?: unknown[];
  };
}

interface HooksResponse {
  hooks: Array<{ id: string }>;
}

interface AgentsResponse {
  agents: Array<{ id: string }>;
}

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

async function fetchHooks(): Promise<HooksResponse> {
  const res = await fetch('/api/hooks');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export function OverviewFooter() {
  const { t } = useTranslation();
  const router = useRouter();

  const { data: settingsData } = useQuery({
    queryKey: ['overview-settings'],
    queryFn: fetchSettings,
  });

  const { data: hooksData } = useQuery({
    queryKey: ['overview-hooks'],
    queryFn: fetchHooks,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['overview-agents'],
    queryFn: fetchAgents,
  });

  const settings = settingsData?.settings ?? {};
  const hooksCount = hooksData?.hooks.length ?? Object.keys(settings.hooks ?? {}).length;
  const permissionsCount = (settings.allowedTools ?? []).length;
  const agentsCount = agentsData?.agents.length ?? 0;

  return (
    <button
      onClick={() => router.push('/settings')}
      className="group flex w-full items-center gap-3 rounded-2xl bg-bg-secondary px-4 py-3 shadow-sm transition-colors hover:bg-bg-tertiary"
    >
      <span className="text-sm text-sidebar-foreground/60">⚙️</span>
      <span className="flex-1 text-left text-xs text-sidebar-foreground/60">
        {t('dashboard.footer.agents', { n: agentsCount })}
        {' · '}
        {t('dashboard.footer.hooks', { n: hooksCount })}
        {' · '}
        {t('dashboard.footer.permissions', { n: permissionsCount })}
      </span>
      <OverviewActionArrow />
    </button>
  );
}
