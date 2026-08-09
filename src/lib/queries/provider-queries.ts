import { useQuery } from '@tanstack/react-query';
import type { ApiProvider, PiModelOption, ProviderModelGroup } from '@/types';
import { fetchJson } from './fetch-json';
import { queryKeys } from './query-keys';

interface ProvidersResponse {
  providers: ApiProvider[];
  env_detected: Record<string, string>;
  default_provider_id: string;
}

interface ProviderModelsResponse {
  groups: ProviderModelGroup[];
  default_provider_id: string;
}

interface PiModelsResponse {
  installed: boolean;
  configured: boolean;
  version: string | null;
  default_model: string;
  models: PiModelOption[];
  error?: string;
}

export function useProvidersQuery() {
  return useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => fetchJson<ProvidersResponse>('/api/providers'),
  });
}

export function useProviderModelsQuery() {
  return useQuery({
    queryKey: queryKeys.providerModels(),
    queryFn: () => fetchJson<ProviderModelsResponse>('/api/providers/models'),
  });
}

export function usePiModelsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.piModels(),
    queryFn: () => fetchJson<PiModelsResponse>('/api/pi/models'),
    enabled,
    staleTime: 30_000,
  });
}
