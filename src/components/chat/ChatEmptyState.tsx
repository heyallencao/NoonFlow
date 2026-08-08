'use client';

import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceEntryActions } from '@/hooks/useWorkspaceEntryActions';
import { FolderPicker } from './FolderPicker';
import type { SessionType } from '@/types';

interface ChatEmptyStateProps {
  sessionType?: SessionType;
  sessionPathPrefix?: string;
}

export function ChatEmptyState({
  sessionType = 'chat',
  sessionPathPrefix = '/chat',
}: ChatEmptyStateProps) {
  const { t } = useTranslation();
  const {
    openOrCreateSession,
    openFolderPicker,
    folderPickerOpen,
    setFolderPickerOpen,
    lastWorkspace,
  } = useWorkspaceEntryActions({
    sessionPathPrefix,
    sessionType,
  });

  const isTerminal = sessionType === 'terminal';
  const titleKey = isTerminal ? 'emptyState.terminal.title' : 'emptyState.chat.title';
  const descriptionKey = isTerminal ? 'emptyState.terminal.description' : 'emptyState.chat.description';

  const suggestions = isTerminal
    ? [
        { key: 'emptyState.terminal.suggestion1', label: t('emptyState.terminal.suggestion1') },
        { key: 'emptyState.terminal.suggestion2', label: t('emptyState.terminal.suggestion2') },
        { key: 'emptyState.terminal.suggestion3', label: t('emptyState.terminal.suggestion3') },
      ]
    : [
        { key: 'emptyState.chat.suggestion1', label: t('emptyState.chat.suggestion1') },
        { key: 'emptyState.chat.suggestion2', label: t('emptyState.chat.suggestion2') },
        { key: 'emptyState.chat.suggestion3', label: t('emptyState.chat.suggestion3') },
        { key: 'emptyState.chat.suggestion4', label: t('emptyState.chat.suggestion4') },
      ];

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="flex flex-col items-center text-center max-w-2xl">
        {/* Title */}
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          {t(titleKey)}
        </h1>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-8">
          {t(descriptionKey)}
        </p>

        {/* Suggestions */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.key}
              variant="outline"
              size="sm"
              className="rounded-full hover:border-primary/50 hover:bg-primary/5 transition-all"
              onClick={() => {
                void openFolderPicker();
              }}
            >
              {suggestion.label}
            </Button>
          ))}
        </div>

        {/* Primary Action */}
        <Button
          size="lg"
          onClick={() => {
            void openFolderPicker();
          }}
        >
          {t(isTerminal ? 'emptyState.terminal.selectWorkspace' : 'emptyState.chat.selectWorkspace')}
        </Button>
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
