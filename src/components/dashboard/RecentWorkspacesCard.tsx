'use client';

import { useMemo } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpenIcon, ArrowRight01Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { useTranslation } from '@/hooks/useTranslation';
import type { WorkspaceOption } from '@/hooks/useWorkspaceEntryActions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface RecentWorkspacesCardProps {
  workspaceOptions: WorkspaceOption[];
  openingWorkspace: string | null;
  openOrCreateSession: (workspacePath: string) => Promise<void>;
}

export function RecentWorkspacesCard({
  workspaceOptions,
  openingWorkspace,
  openOrCreateSession,
}: RecentWorkspacesCardProps) {
  const { t } = useTranslation();

  const recentWorkspaces = useMemo<WorkspaceOption[]>(
    () => workspaceOptions.slice(0, 5),
    [workspaceOptions]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-bg-secondary p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10 text-info">
            <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
          </div>
          <h3 className="text-[15px] font-bold tracking-tight text-foreground">
            {t('dashboard.recentWorkspaces.title') || '最近工作区'}
          </h3>
        </div>
        <Button 
          variant="ghost" 
          size="icon-sm" 
          onClick={() => void openOrCreateSession('')}
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-bg-hover"
          title="Open new workspace"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1">
        {recentWorkspaces.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-bg-primary/50 p-6 text-center">
            <HugeiconsIcon icon={FolderOpenIcon} className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground/80">
              {t('dashboard.recentWorkspaces.empty') || '暂无工作区，请先添加一个项目文件夹。'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentWorkspaces.map((workspace) => {
              const isOpening = openingWorkspace === workspace.path;
              return (
                <button
                  key={workspace.path}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all',
                    isOpening
                      ? 'bg-bg-hover shadow-sm'
                      : 'bg-bg-primary hover:bg-bg-hover hover:shadow-sm'
                  )}
                  onClick={() => {
                    void openOrCreateSession(workspace.path);
                  }}
                  disabled={isOpening}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/5 text-info/70 transition-colors group-hover:bg-info/10 group-hover:text-info">
                    <HugeiconsIcon
                      icon={FolderOpenIcon}
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-foreground transition-colors group-hover:text-info">
                      {workspace.name}
                    </p>
                    <p className="truncate text-[11px] font-medium text-muted-foreground/60 mt-0.5">
                      {workspace.path}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-md bg-muted/10 px-2 py-0.5 text-[10px] font-bold text-muted-foreground/60">
                      {t('workspacePanel.sessionsCount', { n: workspace.sessionCount })}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-1 group-hover:text-info"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
