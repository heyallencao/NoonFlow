'use client';

import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OverviewActionArrow({ className }: { className?: string }) {
  return (
    <ArrowRight
      aria-hidden="true"
      className={cn(
        'h-4 w-4 shrink-0 text-sidebar-foreground/28 transition-colors group-hover:text-sidebar-foreground/60',
        className,
      )}
    />
  );
}
