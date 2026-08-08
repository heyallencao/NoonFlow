"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ZapIcon, Download04Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  selected: boolean;
  onSelect: () => void;
}

export function MarketplaceSkillCard({
  skill,
  selected,
  onSelect,
}: MarketplaceSkillCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-white/[0.04]"
      )}
      onClick={onSelect}
    >
      <HugeiconsIcon icon={ZapIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          {skill.isInstalled ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-green-500/40 text-green-600 dark:text-green-400"
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-2.5 w-2.5 mr-0.5" />
              {t('skills.installed')}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{skill.source}</span>
          {skill.installs > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <HugeiconsIcon icon={Download04Icon} className="h-3 w-3" />
              {skill.installs.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
