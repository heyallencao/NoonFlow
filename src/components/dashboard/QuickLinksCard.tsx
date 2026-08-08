'use client';

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { TranslationKey } from '@/i18n';
import {
  Message02Icon,
  Analytics02Icon,
  DatabaseIcon,
  ZapIcon,
  Plug01Icon,
  CommandLineIcon,
  Settings02Icon,
} from '@hugeicons/core-free-icons';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface QuickLink {
  href: string;
  icon: IconSvgElement;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
}

const quickLinks: QuickLink[] = [
  { href: '/chat', icon: Message02Icon, labelKey: 'nav.chat', descriptionKey: 'dashboard.quickLinks.chatDesc' },
  { href: '/costs', icon: Analytics02Icon, labelKey: 'nav.costs', descriptionKey: 'dashboard.quickLinks.costsDesc' },
  { href: '/widget-telemetry', icon: DatabaseIcon, labelKey: 'nav.widgetTelemetry', descriptionKey: 'dashboard.quickLinks.widgetTelemetryDesc' },
  { href: '/skills', icon: ZapIcon, labelKey: 'nav.skills', descriptionKey: 'dashboard.quickLinks.skillsDesc' },
  { href: '/hooks', icon: Plug01Icon, labelKey: 'nav.hooks', descriptionKey: 'dashboard.quickLinks.hooksDesc' },
  { href: '/agents', icon: CommandLineIcon, labelKey: 'nav.agents', descriptionKey: 'dashboard.quickLinks.agentsDesc' },
  { href: '/settings', icon: Settings02Icon, labelKey: 'nav.settings', descriptionKey: 'dashboard.quickLinks.settingsDesc' },
];

export function QuickLinksCard() {
  const { t } = useTranslation();

  return (
    <div className="rounded-md bg-bg-tertiary p-3">
      <h3 className="mb-3 text-xs font-semibold text-sidebar-foreground">
        {t('dashboard.quickLinks.title') || '快捷入口'}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            data-testid={`overview-quick-link-${link.href.replace(/^\//, '').replace(/\//g, '-')}`}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-md bg-bg-secondary p-2 text-center transition-all',
              'hover:bg-bg-hover hover:scale-105 hover:shadow-md h-16 lg:h-20 2xl:h-24 group'
            )}
          >
            <HugeiconsIcon
              icon={link.icon}
              className="h-4 w-4 shrink-0 text-sidebar-foreground/80 group-hover:text-primary transition-colors"
            />
            <span className="text-[10px] font-medium text-sidebar-foreground leading-none group-hover:text-primary transition-colors">
              {t(link.labelKey)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
