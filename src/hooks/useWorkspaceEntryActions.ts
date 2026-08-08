'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import type { ChatSession, SessionType } from '@/types';
import { buildCreateSessionPreferencePayload } from '@/lib/chat-preferences';
import {
  buildWorkspaceList,
  normalizeWorkspacePath,
} from '@/lib/workspace-utils';
import {
  publishSessionCreated,
  subscribeSessionRefresh,
  type SessionRefreshDetail,
} from '@/lib/events/session-refresh-hub';
import {
  fetchSessionsForOpenedWorkspaces,
  useSessionsQuery,
} from '@/lib/queries/session-queries';
import { useWorkspaceStore } from '@/stores/workspace-store';

export interface WorkspaceOption {
  path: string;
  name: string;
  sessionCount: number;
  latestUpdatedAt: number;
  latestSessionId: string | null;
}

export interface UseWorkspaceEntryActionsOptions {
  sessionPathPrefix?: string;
  sessionType?: SessionType;
}

export interface UseWorkspaceEntryActionsResult {
  workspaceOptions: WorkspaceOption[];
  lastWorkspace: string;
  openingWorkspace: string | null;
  openOrCreateSession: (workspacePath: string) => Promise<void>;
  openFolderPicker: () => Promise<void>;
  folderPickerOpen: boolean;
  setFolderPickerOpen: (open: boolean) => void;
  refetchSessions: () => void;
}

export function useWorkspaceEntryActions(
  options: UseWorkspaceEntryActionsOptions = {}
): UseWorkspaceEntryActionsResult {
  const { sessionPathPrefix = '/chat', sessionType = 'chat' } = options;
  const router = useRouter();
  const { t } = useTranslation();
  const { hasNativeFolderDialog, openNativePicker } = useNativeFolderPicker();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState<string | null>(null);

  const workspacePaths = useWorkspaceStore((state) => state.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((state) => state.hiddenWorkspaces);
  const lastWorkspaceHint = useWorkspaceStore((state) => state.lastWorkspace);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrate);
  const rememberWorkspace = useWorkspaceStore((state) => state.rememberWorkspace);
  const setLastWorkspace = useWorkspaceStore((state) => state.setLastWorkspace);

  const sessionsQuery = useSessionsQuery('all', workspacePaths);
  const sessions = useMemo<ChatSession[]>(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions]
  );

  useEffect(() => {
    hydrateWorkspaces();
  }, [hydrateWorkspaces]);

  useEffect(() => {
    const handler = (detail: SessionRefreshDetail) => {
      if (detail.type === 'updated') {
        return;
      }
      void sessionsQuery.refetch();
    };
    return subscribeSessionRefresh(handler);
  }, [sessionsQuery]);

  const workspaceOptions = useMemo<WorkspaceOption[]>(
    () => buildWorkspaceList({
      workspaces: workspacePaths,
      hiddenWorkspaces,
      sessions,
      latestSessionType: sessionType,
    }),
    [workspacePaths, hiddenWorkspaces, sessions, sessionType]
  );

  const lastWorkspace = useMemo(
    () => lastWorkspaceHint || workspaceOptions[0]?.path || '',
    [lastWorkspaceHint, workspaceOptions]
  );

  const openOrCreateSession = useCallback(
    async (workspacePath: string) => {
      const normalized = normalizeWorkspacePath(workspacePath);
      if (!normalized) return;

      setOpeningWorkspace(normalized);
      rememberWorkspace(normalized);
      setLastWorkspace(normalized);

      try {
        const latestSessions = await fetchSessionsForOpenedWorkspaces('all', [normalized]);
        const existing = latestSessions.sessions.find((session) => (
          session.session_type === sessionType
          && normalizeWorkspacePath(session.working_directory || '') === normalized
        ));
        if (existing) {
          router.replace(`${sessionPathPrefix}/${existing.id}`);
          return;
        }

        const sessionPreferences = buildCreateSessionPreferencePayload();
        const res = await fetch('/api/chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            working_directory: normalized,
            ...sessionPreferences,
            session_type: sessionType,
          }),
        });
        if (!res.ok) {
          throw new Error('Failed to create session');
        }
        const data = await res.json();
        const sessionId: string = data.session?.id;
        if (!sessionId) {
          throw new Error('Invalid session id');
        }
        publishSessionCreated({ sessionId, sessionType, workingDirectory: normalized });
        router.replace(`${sessionPathPrefix}/${sessionId}`);
      } catch {
        setFolderPickerOpen(true);
      } finally {
        setOpeningWorkspace(null);
      }
    },
    [
      rememberWorkspace,
      setLastWorkspace,
      router,
      sessionPathPrefix,
      sessionType,
    ]
  );

  const openFolderPicker = useCallback(async () => {
    const defaultPath = lastWorkspace || workspaceOptions[0]?.path || '';

    if (hasNativeFolderDialog) {
      const selectedPath = await openNativePicker({
        defaultPath: defaultPath || undefined,
        title: t('folderPicker.title'),
      });
      if (selectedPath) {
        await openOrCreateSession(selectedPath);
      }
      return;
    }

    setFolderPickerOpen(true);
  }, [hasNativeFolderDialog, lastWorkspace, openNativePicker, openOrCreateSession, t, workspaceOptions]);

  const refetchSessions = useCallback(() => {
    void sessionsQuery.refetch();
  }, [sessionsQuery]);

  return {
    workspaceOptions,
    lastWorkspace,
    openingWorkspace,
    openOrCreateSession,
    openFolderPicker,
    folderPickerOpen,
    setFolderPickerOpen,
    refetchSessions,
  };
}
