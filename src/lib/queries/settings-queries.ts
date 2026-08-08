import { useQuery } from '@tanstack/react-query';
import type { SettingsResponse } from '@/types';
import { fetchJson } from './fetch-json';
import { queryKeys } from './query-keys';

interface AppSettingsResponse {
  settings: Record<string, string>;
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => fetchJson<SettingsResponse>('/api/settings'),
  });
}

export function useAppSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: () => fetchJson<AppSettingsResponse>('/api/settings/app'),
  });
}
