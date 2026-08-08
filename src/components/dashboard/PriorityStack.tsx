'use client';

import { AlertsSection } from './AlertsSection';
import { RecommendationsSection } from './RecommendationsSection';
import { useTranslation } from '@/hooks/useTranslation';

export function PriorityStack() {
  const { locale } = useTranslation();
  return (
    <div className="flex flex-col">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] uppercase text-sidebar-foreground/40 mb-8">
        {locale === 'zh' ? '高优事项' : 'Priority Stack'}
      </h2>
      <div className="flex flex-col gap-10">
        <AlertsSection />
        <RecommendationsSection />
      </div>
    </div>
  );
}
