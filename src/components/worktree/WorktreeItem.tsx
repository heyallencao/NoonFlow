'use client';

import { Cancel01Icon, GitBranchIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Worktree } from '@/types';

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

  return (
    <div
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
        isActive
          ? 'bg-bg-hover text-sidebar-foreground'
          : 'text-sidebar-foreground/72 hover:bg-bg-tertiary hover:text-sidebar-foreground',
      )}
      onClick={() => onSelect(worktree)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(worktree);
        }
      }}
      role="button"
      tabIndex={0}
      title={worktree.worktree_path}
      data-testid={`worktree-item-${worktree.id}`}
    >
      <HugeiconsIcon icon={GitBranchIcon} className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium">{worktree.name}</div>
        <div className="truncate text-[9.5px] text-sidebar-foreground/45">
          {worktree.is_managed ? t('workspacePanel.managedWorktree') : t('workspacePanel.externalWorktree')}
          {sessionCount > 0 ? ` · ${t('workspacePanel.worktreeSessions', { n: sessionCount })}` : ''}
        </div>
      </div>
      {worktree.is_managed && onDelete ? (
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/35 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(worktree);
          }}
          aria-label={t('workspacePanel.deleteWorktree')}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
