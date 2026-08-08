'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { OverviewActionArrow } from '@/components/dashboard/OverviewActionArrow';
import type { MCPServerConfig } from '@/types';

interface SkillFile {
  name: string;
  description: string;
  source: string;
}

interface SkillsResponse {
  skills?: SkillFile[];
  plugins?: SkillFile[];
}

interface HookItem {
  id: string;
  runtime: 'claude' | 'codex';
  event: string;
}

interface HooksResponse {
  hooks: HookItem[];
}

interface AgentItem {
  id: string;
  runtime: 'claude' | 'codex';
  name: string;
}

interface AgentsResponse {
  agents: AgentItem[];
}

interface MCPConfigResponse {
  mcpServers: Record<string, MCPServerConfig>;
}

async function fetchSkills(): Promise<SkillsResponse> {
  const res = await fetch('/api/skills');
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

async function fetchMCPServers(): Promise<MCPConfigResponse> {
  const res = await fetch('/api/plugins/mcp');
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

interface SmallCardProps {
  title: string;
  href: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}

function SmallCard({ title, href, count, emptyLabel, children }: SmallCardProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group flex min-h-[142px] flex-col rounded-2xl bg-bg-secondary p-3.5 text-left shadow-sm transition-colors hover:bg-bg-tertiary/60"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/42">
            {title}
          </div>
          <div className="mt-1.5 text-[1.6rem] font-semibold leading-none text-sidebar-foreground">
            {count}
          </div>
        </div>
        <OverviewActionArrow />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 text-xs text-sidebar-foreground/72">
        {count === 0 ? <span className="text-sidebar-foreground/40">{emptyLabel}</span> : children}
      </div>
    </button>
  );
}

function SmallCardItem({
  label,
  meta,
  accentClassName,
}: {
  label: string;
  meta?: string;
  accentClassName: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-bg-primary/40 px-2.5 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${accentClassName}`} />
        <span className="truncate text-[12px] text-sidebar-foreground/80">{label}</span>
      </div>
      {meta ? <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/38">{meta}</span> : null}
    </div>
  );
}

function formatSource(source: string) {
  switch (source) {
    case 'global':
      return 'global';
    case 'project':
      return 'project';
    case 'installed':
      return 'installed';
    case 'plugin':
      return 'plugin';
    default:
      return source;
  }
}

export function SmallCardsSection() {
  const { t } = useTranslation();

  const { data: skillsData } = useQuery({
    queryKey: ['overview-skills'],
    queryFn: fetchSkills,
  });

  const { data: hooksData } = useQuery({
    queryKey: ['overview-hooks'],
    queryFn: fetchHooks,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['overview-agents'],
    queryFn: fetchAgents,
  });

  const { data: mcpData } = useQuery({
    queryKey: ['overview-mcp-servers'],
    queryFn: fetchMCPServers,
  });

  const skills = skillsData?.skills ?? skillsData?.plugins ?? [];
  const hooks = hooksData?.hooks ?? [];
  const agents = agentsData?.agents ?? [];
  const mcpServers = Object.entries(mcpData?.mcpServers ?? {}).map(([name, config]) => ({
    name,
    kind: config?.type || (config?.url ? 'http' : 'stdio'),
  }));
  const MAX_ITEMS = 3;

  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4">
      <SmallCard
        title={t('dashboard.skills.title')}
        href="/skills"
        count={skills.length}
        emptyLabel={t('dashboard.skills.empty')}
      >
        <>
          {skills.slice(0, MAX_ITEMS).map((skill) => (
            <SmallCardItem
              key={skill.name}
              label={skill.name}
              meta={formatSource(skill.source)}
              accentClassName="bg-amber-400"
            />
          ))}
          {skills.length > MAX_ITEMS ? (
            <span className="px-1 text-[11px] text-sidebar-foreground/38">+{skills.length - MAX_ITEMS} more</span>
          ) : null}
        </>
      </SmallCard>

      <SmallCard
        title={t('dashboard.hooks.title')}
        href="/hooks"
        count={hooks.length}
        emptyLabel={t('dashboard.hooks.empty')}
      >
        <>
          {hooks.slice(0, MAX_ITEMS).map((hook) => (
            <SmallCardItem
              key={hook.id}
              label={hook.event}
              meta={hook.runtime}
              accentClassName="bg-sky-400"
            />
          ))}
          {hooks.length > MAX_ITEMS ? (
            <span className="px-1 text-[11px] text-sidebar-foreground/38">+{hooks.length - MAX_ITEMS} more</span>
          ) : null}
        </>
      </SmallCard>

      <SmallCard
        title={t('dashboard.agents.title')}
        href="/agents"
        count={agents.length}
        emptyLabel={t('dashboard.agents.empty')}
      >
        <>
          {agents.slice(0, MAX_ITEMS).map((agent) => (
            <SmallCardItem
              key={agent.id}
              label={agent.name}
              meta={agent.runtime}
              accentClassName="bg-violet-400"
            />
          ))}
          {agents.length > MAX_ITEMS ? (
            <span className="px-1 text-[11px] text-sidebar-foreground/38">+{agents.length - MAX_ITEMS} more</span>
          ) : null}
        </>
      </SmallCard>

      <SmallCard
        title={t('dashboard.mcp.title')}
        href="/mcp"
        count={mcpServers.length}
        emptyLabel={t('dashboard.mcp.empty')}
      >
        <>
          {mcpServers.slice(0, MAX_ITEMS).map((server) => (
            <SmallCardItem
              key={server.name}
              label={server.name}
              meta={server.kind}
              accentClassName="bg-emerald-400"
            />
          ))}
          {mcpServers.length > MAX_ITEMS ? (
            <span className="px-1 text-[11px] text-sidebar-foreground/38">
              +{mcpServers.length - MAX_ITEMS} more
            </span>
          ) : null}
        </>
      </SmallCard>
    </div>
  );
}
