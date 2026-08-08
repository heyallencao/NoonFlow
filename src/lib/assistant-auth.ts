import type { AssistantRuntime } from '@/types';

export type AssistantAuthMode = 'login' | 'api_key';

export const CLAUDE_AUTH_MODE_KEY = 'claude_auth_mode';
export const CODEX_AUTH_MODE_KEY = 'codex_auth_mode';

export function getAuthModeSettingKey(runtime: AssistantRuntime): string {
  return runtime === 'claude_code'
    ? CLAUDE_AUTH_MODE_KEY
    : CODEX_AUTH_MODE_KEY;
}

export function normalizeAssistantAuthMode(value: string | null | undefined): AssistantAuthMode | null {
  return value === 'login' || value === 'api_key' ? value : null;
}

export function inferAssistantAuthMode(
  options: {
    storedMode?: string | null;
    storedToken?: string | null;
    storedBaseUrl?: string | null;
    envToken?: string | null;
    envBaseUrl?: string | null;
  } = {},
): AssistantAuthMode {
  const storedMode = normalizeAssistantAuthMode(options.storedMode);
  if (storedMode) {
    return storedMode;
  }

  const hasApiConfig = Boolean(
    options.storedToken
      || options.storedBaseUrl
      || options.envToken
      || options.envBaseUrl,
  );

  return hasApiConfig ? 'api_key' : 'login';
}
