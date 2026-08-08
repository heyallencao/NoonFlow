'use client';

import { cn } from '@/lib/utils';
import { useImageGen } from '@/hooks/useImageGen';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ImageGenToggle() {
  const { state, setEnabled } = useImageGen();
  const { t } = useTranslation();

  const handleToggle = () => {
    setEnabled(!state.enabled);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'inline-flex items-center justify-center rounded-full px-2.5 h-7 text-xs font-medium border transition-all',
            state.enabled
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
              : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-white/[0.04]'
          )}
        >
          {t('imageGen.toggleLabel' as TranslationKey)}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {t('imageGen.toggleTooltip' as TranslationKey)}
      </TooltipContent>
    </Tooltip>
  );
}
