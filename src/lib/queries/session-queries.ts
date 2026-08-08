import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  MessagesResponse,
  SessionListType,
  SessionsResponse,
} from '@/types';
import { fetchJson } from './fetch-json';
import { queryKeys } from './query-keys';

interface SessionDetailResponse {
  session: import('@/types').ChatSession;
  recovery?: unknown;
  runtimeState?: unknown;
}

export function useSessionsQuery(type: SessionListType = 'chat', openedWorkspaces?: readonly string[]) {
  const workspaces = Array.from(new Set((openedWorkspaces || []).filter(Boolean)));
  return useQuery({
    queryKey: [...queryKeys.sessions(type), workspaces],
    queryFn: () => openedWorkspaces
      ? fetchSessionsForOpenedWorkspaces(type, workspaces)
      : fetchJson<SessionsResponse>(`/api/chat/sessions?type=${encodeURIComponent(type)}`),
    refetchOnWindowFocus: false,
  });
}

export function fetchSessionsForOpenedWorkspaces(
  type: SessionListType,
  openedWorkspaces: readonly string[],
) {
  const workspaces = Array.from(new Set(openedWorkspaces.filter(Boolean)));
  const params = new URLSearchParams({ type });
  params.set('openedOnly', '1');
  for (const workspace of workspaces) params.append('workspace', workspace);
  return fetchJson<SessionsResponse>(`/api/chat/sessions?${params.toString()}`);
}

export function useSessionQuery(sessionId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchJson<SessionDetailResponse>(`/api/chat/sessions/${sessionId}`),
    enabled: enabled && Boolean(sessionId),
  });
}

export function useSessionMessagesQuery({
  sessionId,
  limit = 30,
  beforeRowId,
  enabled = true,
}: {
  sessionId: string;
  limit?: number;
  beforeRowId?: number;
  enabled?: boolean;
}) {
  const searchParams = new URLSearchParams({ limit: String(limit) });
  if (beforeRowId !== undefined) {
    searchParams.set('before', String(beforeRowId));
  }

  return useQuery({
    queryKey: queryKeys.sessionMessages(sessionId, limit, beforeRowId),
    queryFn: () => fetchJson<MessagesResponse>(`/api/chat/sessions/${sessionId}/messages?${searchParams.toString()}`),
    enabled: enabled && Boolean(sessionId),
    placeholderData: keepPreviousData,
  });
}
