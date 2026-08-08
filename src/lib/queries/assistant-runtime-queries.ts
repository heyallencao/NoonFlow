import { useQuery } from '@tanstack/react-query';
import type { AssistantRuntimeListResponse } from '@/types';
import { fetchJson } from './fetch-json';
import { queryKeys } from './query-keys';

export function useAssistantRuntimesQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.assistantRuntimes(),
    queryFn: () => fetchJson<AssistantRuntimeListResponse>('/api/assistant-runtimes'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
