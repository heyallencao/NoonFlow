'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';

async function fetchSkills() { const res = await fetch('/api/skills'); return res.json(); }
async function fetchHooks() { const res = await fetch('/api/hooks'); return res.json(); }
async function fetchAgents() { const res = await fetch('/api/agents'); return res.json(); }
async function fetchMemoryArchives() { const res = await fetch('/api/memory/archives'); return res.json(); }

export function ResourceShelf() {
  const { t, locale } = useTranslation();
  const router = useRouter();

  const { data: skillsData } = useQuery({ queryKey: ['overview-skills'], queryFn: fetchSkills });
  const { data: hooksData } = useQuery({ queryKey: ['overview-hooks'], queryFn: fetchHooks });
  const { data: agentsData } = useQuery({ queryKey: ['overview-agents'], queryFn: fetchAgents });
  const { data: memoryData } = useQuery({ queryKey: ['overview-memory-archives'], queryFn: fetchMemoryArchives });

  const skillsCount = (skillsData?.skills ?? skillsData?.plugins ?? []).length;
  const hooksCount = (hooksData?.hooks ?? []).length;
  const agentsCount = (agentsData?.agents ?? []).length;
  const memoryCount = (memoryData?.archives ?? []).length;

  const resources = [
    { label: t('dashboard.skills.title'), count: skillsCount, href: '/skills' },
    { label: t('dashboard.hooks.title'), count: hooksCount, href: '/hooks' },
    { label: t('dashboard.agents.title'), count: agentsCount, href: '/agents' },
    { label: t('dashboard.memory.title'), count: memoryCount, href: '/memory' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] uppercase text-sidebar-foreground/40 mb-2">
        {locale === 'zh' ? '资源库' : 'Resource Shelf'}
      </h2>
      <div className="flex flex-wrap gap-8 sm:gap-12">
        {resources.map((res) => (
          <button
            key={res.label}
            onClick={() => router.push(res.href)}
            className="flex items-baseline gap-2.5 group hover:opacity-80 transition-opacity"
          >
            <span className="text-2xl font-light text-sidebar-foreground/90">
              {res.count}
            </span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80 transition-colors">
              {res.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
