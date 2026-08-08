'use client';

import * as React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/stores/workspace-store';
import {
  getWorkspaceName,
  getWorkspacePathHint,
  isManagedWorktreeSubPath,
} from '@/lib/workspace-utils';
import { cn } from '@/lib/utils';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, GlobeIcon } from '@hugeicons/core-free-icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL_PROJECTS_VALUE = '__all_projects__';

interface WorkspaceOption {
  path: string;
  name?: string;
}

interface ResolvedWorkspaceOption extends WorkspaceOption {
  subtitle: string;
}

interface CodebaseHeaderProps {
  title: string;
  count?: number;
  description?: string;
  showScopeSwitcher?: boolean;
  selectedWorkspace?: string | null;
  onWorkspaceChange?: (workspacePath: string | null) => void;
  workspaceOptions?: WorkspaceOption[];
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function CodebaseHeader({
  title,
  count,
  description,
  showScopeSwitcher = true,
  selectedWorkspace = null,
  onWorkspaceChange,
  workspaceOptions,
  action,
  children,
  className,
}: CodebaseHeaderProps) {
  const { t } = useTranslation();
  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const resolvedWorkspaceOptions = React.useMemo(() => {
    const source: WorkspaceOption[] = workspaceOptions ?? workspacePaths.map((path) => ({ path }));
    const deduped = new Map<string, WorkspaceOption>();

    for (const option of source) {
      if (!option.path) continue;
      if (isManagedWorktreeSubPath(option.path)) continue;
      deduped.set(option.path, {
        path: option.path,
        name: option.name || getWorkspaceName(option.path),
      });
    }

    const options = Array.from(deduped.values());
    const nameCounts = new Map<string, number>();

    for (const option of options) {
      nameCounts.set(option.name || '', (nameCounts.get(option.name || '') || 0) + 1);
    }

    return options.map((option): ResolvedWorkspaceOption => ({
      ...option,
      subtitle: (nameCounts.get(option.name || '') || 0) > 1 ? getWorkspacePathHint(option.path) : '',
    }));
  }, [workspaceOptions, workspacePaths]);
  const selectedWorkspaceName = selectedWorkspace
    ? resolvedWorkspaceOptions.find((option) => option.path === selectedWorkspace)?.name ||
      getWorkspaceName(selectedWorkspace)
    : t('memory.filterAllProjects');

  return (
    <div className={cn('mb-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{title}</h1>
            {typeof count === 'number' && (
              <span className="inline-flex h-6 items-center rounded-full bg-bg-tertiary px-2.5 text-[11px] font-bold tracking-wider text-muted-foreground border border-border-subtle uppercase">
                {count}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {action}
          {showScopeSwitcher && (
            <Select
              value={selectedWorkspace ?? ALL_PROJECTS_VALUE}
              onValueChange={(value) => onWorkspaceChange?.(value === ALL_PROJECTS_VALUE ? null : value)}
            >
              <SelectTrigger className="h-10 min-w-[220px] max-w-[320px] rounded-2xl border-border-subtle bg-card px-3.5 text-[13px] font-semibold shadow-[var(--shadow-lg)] backdrop-blur-sm">
                <div className="flex min-w-0 items-center">
                  <SelectValue>{selectedWorkspaceName}</SelectValue>
                </div>
              </SelectTrigger>
              <SelectContent
                align="end"
                sideOffset={10}
                className="max-w-[380px] rounded-2xl border-border-subtle/80 bg-popover/96 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
              >
                <div className="border-b border-border-subtle/60 px-3.5 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
                    {t('nav.groupWorkspace')}
                  </p>
                </div>
                <SelectItem value={ALL_PROJECTS_VALUE} className="mx-1.5 mt-1.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-bg-secondary text-muted-foreground">
                      <HugeiconsIcon icon={GlobeIcon} className="h-4 w-4" />
                    </div>
                    <div className="flex min-w-0 flex-col items-start">
                      <span className="truncate text-[13px] font-semibold">{t('memory.filterAllProjects')}</span>
                      <span className="truncate text-[11px] text-muted-foreground/72">
                        {t('dashboard.metrics.activeWorkspaces')}
                      </span>
                    </div>
                  </div>
                </SelectItem>
                {resolvedWorkspaceOptions.length > 0 && <SelectSeparator />}
                {resolvedWorkspaceOptions.map((option) => (
                  <SelectItem key={option.path} value={option.path} className="mx-1.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-bg-secondary text-muted-foreground">
                        <HugeiconsIcon icon={Folder01Icon} className="h-4 w-4" />
                      </div>
                      <div className="flex min-w-0 flex-col items-start">
                        <span className="truncate text-[13px] font-semibold">{option.name}</span>
                        {option.subtitle ? (
                          <span className="truncate text-[11px] text-muted-foreground/72">
                            {option.subtitle}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      {children && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children}
        </div>
      )}
    </div>
  );
}
