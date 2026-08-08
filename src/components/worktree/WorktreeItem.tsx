'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Worktree } from '@/types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  GitBranchIcon,
  Cancel01Icon,
  CheckmarkBadge02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

interface WorktreeItemProps {
  worktree: Worktree;
  isActive: boolean;
  sessionCount: number;
  onSelect: (worktree: Worktree) => void;
  onDelete?: (worktree: Worktree) => void;
}

export function WorktreeItem({
  worktree,
  isActive,
  sessionCount,
  onSelect,
  onDelete,
}: WorktreeItemProps) {
  const { t } = useTranslation();
  const [hovering, setHovering] = useState(false);
  const normalizedName = worktree.name.trim();
  const isPlaceholderDefaultName =
    worktree.is_default && normalizedName.toLowerCase() === 'default';
  const fallbackName = t('workspacePanel.defaultWorktree');
  const displayName = isPlaceholderDefaultName
    ? (worktree.branch || fallbackName)
    : (normalizedName || worktree.branch || fallbackName);

  return (
    <div
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all duration-200',
        isActive
          ? 'bg-gradient-to-r from-bg-hover/80 to-bg-hover/40 text-sidebar-foreground shadow-sm'
          : 'text-sidebar-foreground/75 hover:bg-bg-tertiary/60 hover:text-sidebar-foreground hover:shadow-sm'
      )}
      onClick={() => onSelect(worktree)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(worktree);
        }
      }}
      style={{
        transform: isActive ? 'translateX(2px)' : 'translateX(0)',
        transition: 'all 0.2s cubic-bezier(0.25, 1, 0.5, 1)',
      }}
    >
      {/* Subtle left accent for active state */}
      {isActive && (
        <div className="absolute left-0 top-1/2 h-3/5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-foreground/30" />
      )}

      <div className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all duration-200",
        isActive
          ? "bg-bg-tertiary/50 text-sidebar-foreground/90"
          : "bg-bg-tertiary/30 text-sidebar-foreground/60 group-hover:bg-bg-tertiary/50"
      )}>
        <HugeiconsIcon
          icon={GitBranchIcon}
          className="h-3.5 w-3.5"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "truncate text-[12px] font-medium leading-tight transition-colors",
              isActive ? "text-sidebar-foreground" : "text-sidebar-foreground/85"
            )}>
              {displayName}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-[32rem] break-all">
            {displayName}
          </TooltipContent>
        </Tooltip>
        {sessionCount > 0 && (
          <span className="text-[10px] leading-none text-sidebar-foreground/50">
            {sessionCount === 1
              ? t('workspacePanel.worktreeSession', { n: sessionCount })
              : t('workspacePanel.worktreeSessions', { n: sessionCount })}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {worktree.is_default && (
          <div
            className="flex h-5 items-center justify-center rounded-md bg-bg-tertiary/40 px-1.5"
            title={t('workspacePanel.defaultWorktree')}
          >
            <HugeiconsIcon
              icon={CheckmarkBadge02Icon}
              className="h-3 w-3 text-sidebar-foreground/60"
            />
          </div>
        )}

        {!worktree.is_default && onDelete && (
          <button
            type="button"
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200",
              hovering
                ? "bg-red-500/10 text-red-400/90 opacity-100"
                : "text-sidebar-foreground/40 opacity-0"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(worktree);
            }}
            aria-label={t('workspacePanel.deleteWorktree')}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
