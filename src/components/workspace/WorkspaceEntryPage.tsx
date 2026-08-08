'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  FolderOpenIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { FolderPicker } from '@/components/chat/FolderPicker';
import { Button } from '@/components/ui/button';
import { useWorkspaceEntryActions } from '@/hooks/useWorkspaceEntryActions';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import type { SessionType } from '@/types';

interface WorkspaceEntryPageProps {
  sessionType?: SessionType;
  sessionPathPrefix?: string;
  titleKey?: TranslationKey;
  descriptionKey?: TranslationKey;
  selectWorkspaceKey?: TranslationKey;
  useLastWorkspaceKey?: TranslationKey;
  recentWorkspacesKey?: TranslationKey;
  emptyWorkspaceKey?: TranslationKey;
}

export function WorkspaceEntryPage({
  sessionType = 'chat',
  sessionPathPrefix = '/chat',
  titleKey = 'workspaceEntry.title',
  descriptionKey = 'workspaceEntry.description',
  selectWorkspaceKey = 'workspaceEntry.selectWorkspace',
  useLastWorkspaceKey = 'workspaceEntry.useLastWorkspace',
  recentWorkspacesKey = 'workspaceEntry.recentWorkspaces',
  emptyWorkspaceKey = 'workspaceEntry.noWorkspace',
}: WorkspaceEntryPageProps) {
  const { t } = useTranslation();
  const {
    workspaceOptions,
    lastWorkspace,
    openingWorkspace,
    openOrCreateSession,
    openFolderPicker,
    folderPickerOpen,
    setFolderPickerOpen,
  } = useWorkspaceEntryActions({
    sessionPathPrefix,
    sessionType,
  });

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-bg-secondary p-5 sm:p-6">
        <h1 className="text-xl font-semibold text-sidebar-foreground">{t(titleKey)}</h1>
        <p className="mt-2 text-sm text-sidebar-foreground/72">{t(descriptionKey)}</p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            data-testid="workspace-entry-select"
            onClick={() => {
              void openFolderPicker();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
            {t(selectWorkspaceKey)}
          </Button>

          <Button
            size="sm"
            variant="outline"
            data-testid="workspace-entry-last"
            disabled={!lastWorkspace || Boolean(openingWorkspace)}
            onClick={() => {
              if (!lastWorkspace) return;
              void openOrCreateSession(lastWorkspace);
            }}
          >
            <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
            {t(useLastWorkspaceKey)}
          </Button>
        </div>

        <div className="mt-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/52">
            {t(recentWorkspacesKey)}
          </div>

          {workspaceOptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-bg-tertiary px-4 py-5 text-sm text-sidebar-foreground/68">
              {t(emptyWorkspaceKey)}
            </div>
          ) : (
            <div className="space-y-2">
              {workspaceOptions.map((workspace) => {
                const isOpening = openingWorkspace === workspace.path;

                return (
                  <button
                    key={workspace.path}
                    type="button"
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all',
                      isOpening
                        ? 'bg-bg-hover'
                        : 'bg-bg-tertiary hover:bg-bg-hover'
                    )}
                    onClick={() => {
                      void openOrCreateSession(workspace.path);
                    }}
                    disabled={isOpening}
                  >
                    <HugeiconsIcon
                      icon={FolderOpenIcon}
                      className="h-4 w-4 shrink-0 text-sidebar-foreground/82"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-sidebar-foreground">
                        {workspace.name}
                      </p>
                      <p className="truncate text-[11px] text-sidebar-foreground/60">
                        {workspace.path}
                      </p>
                    </div>

                    <span className="shrink-0 text-[11px] text-sidebar-foreground/68">
                      {t('workspacePanel.sessionsCount', { n: workspace.sessionCount })}
                    </span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/55 transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(path) => {
          void openOrCreateSession(path);
        }}
        initialPath={lastWorkspace || undefined}
      />
    </div>
  );
}
