"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IconSvgElement } from "@hugeicons/react";

interface AutomationCatalogListItemProps {
  title: string;
  description: string;
  icon: IconSvgElement;
  iconClassName: string;
  badge?: string;
  metaBadge?: string;
  onClick: () => void;
}

export function AutomationCatalogListItem({
  title,
  description,
  icon,
  iconClassName,
  badge,
  metaBadge,
  onClick,
}: AutomationCatalogListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-4 rounded-2xl border border-transparent bg-bg-secondary p-4 text-left transition-all",
        "hover:border-white/5 hover:bg-bg-hover hover:shadow-sm",
      )}
    >
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors", iconClassName)}>
        <HugeiconsIcon icon={icon} className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-bold leading-tight text-foreground">
            {title}
          </span>
          {badge ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {badge}
            </Badge>
          ) : null}
          {metaBadge ? (
            <span className="rounded-md bg-muted/20 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80">
              {metaBadge}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-normal text-muted-foreground">
          {description}
        </p>
      </div>
    </button>
  );
}
