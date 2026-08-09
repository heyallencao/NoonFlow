import type { SessionListType } from '@/types';

export const queryKeys = {
  sessions: (type: SessionListType = 'chat') => ['sessions', type] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
  sessionMessages: (sessionId: string, limit: number, beforeRowId?: number) =>
    ['session-messages', sessionId, limit, beforeRowId ?? null] as const,
  providers: () => ['providers'] as const,
  providerModels: () => ['provider-models'] as const,
  piModels: () => ['pi-models'] as const,
  assistantRuntimes: () => ['assistant-runtimes'] as const,
  settings: () => ['settings'] as const,
  appSettings: () => ['app-settings'] as const,
};
