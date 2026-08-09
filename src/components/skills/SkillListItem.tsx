"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { ZapIcon, Delete02Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Switch } from "@/components/ui/switch";

export interface SkillItem {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin" | "installed";
  installedSource?: "agents" | "claude";
  skillTarget?: "agents" | "claude" | "pi";
  runtimeAvailability?: Array<"claude" | "codex" | "pi">;
  filePath: string;
  enabled?: boolean;
}

export function getSkillItemKey(
  skill: Pick<SkillItem, "filePath" | "source" | "installedSource" | "name">
) {
  return skill.filePath || `${skill.source}:${skill.installedSource ?? "default"}:${skill.name}`;
}

export function isSameSkillItem(
  left: Pick<SkillItem, "filePath" | "source" | "installedSource" | "name">,
  right: Pick<SkillItem, "filePath" | "source" | "installedSource" | "name">
) {
  return getSkillItemKey(left) === getSkillItemKey(right);
}

interface SkillListItemProps {
  skill: SkillItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: (skill: SkillItem) => void;
  onToggle?: (skill: SkillItem, enabled: boolean) => void;
}

export function SkillListItem({
  skill,
  selected,
  onSelect,
  onDelete,
  onToggle,
}: SkillListItemProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [enabled, setEnabled] = useState(skill.enabled !== false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (skill.source === "installed") {
      onDelete(skill);
      return;
    }
    if (confirmDelete) {
      onDelete(skill);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextValue = !enabled;
    setEnabled(nextValue);
    onToggle?.(skill, nextValue);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-2xl bg-bg-secondary p-4 cursor-pointer transition-all border border-transparent",
        "hover:bg-bg-hover hover:border-white/5 hover:shadow-sm",
        selected && "border-primary/20 bg-bg-hover ring-1 ring-primary/20"
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setConfirmDelete(false);
      }}
    >
      <div className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
        enabled ? "bg-primary/10 text-primary" : "bg-muted/10 text-muted-foreground"
      )}>
        <HugeiconsIcon icon={ZapIcon} className="h-5 w-5" />
      </div>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-[14px] font-bold truncate leading-tight transition-colors",
            enabled ? "text-foreground" : "text-muted-foreground/60"
          )}>
            {skill.name}
          </span>
          {skill.source === "global" && (
            <span className={cn(
              "px-1.5 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-tight transition-colors",
              enabled ? "bg-primary/5 text-primary/80" : "bg-muted/10 text-muted-foreground/40"
            )}>
              Global
            </span>
          )}
        </div>
        <p className={cn(
          "text-[12px] line-clamp-2 mt-0.5 leading-normal transition-colors",
          enabled ? "text-muted-foreground" : "text-muted-foreground/30"
        )}>
          {skill.description || "No description provided."}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
        {skill.runtimeAvailability?.map((runtime) => (
          <span key={runtime} className="rounded border border-border-subtle bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
            {runtime === "claude" ? "Claude" : runtime === "codex" ? "Codex" : "Pi"}
          </span>
        ))}
        {hovered && !confirmDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                <HugeiconsIcon icon={Settings02Icon} className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        )}

        {(hovered || confirmDelete) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={confirmDelete ? "destructive" : "ghost"}
                size="icon-xs"
                className={cn(
                  "h-8 w-8 rounded-lg transition-all",
                  confirmDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                onClick={handleDelete}
              >
                <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {confirmDelete ? t("skills.deleteConfirm") : t("common.delete")}
            </TooltipContent>
          </Tooltip>
        )}

        <div className="ml-1 flex items-center" onClick={handleToggle}>
          <Switch 
            checked={enabled} 
            onCheckedChange={(checked) => {
              setEnabled(checked);
              onToggle?.(skill, checked);
            }}
          />
        </div>
      </div>
    </div>
  );
}
