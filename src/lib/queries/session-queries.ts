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

export function useSessionsQuery(type: SessionListType = 'chat') {
  return useQuery({
    queryKey: queryKeys.sessions(type),
    queryFn: () => fetchJson<SessionsResponse>(`/api/chat/sessions?type=${type}`),
    refetchOnWindowFocus: false,
  });
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
