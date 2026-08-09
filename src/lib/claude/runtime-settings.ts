import os from 'node:os';

import type { ApiProvider } from '@/types';
import { CLAUDE_AUTH_MODE_KEY, inferAssistantAuthMode } from '../assistant-auth';
import { getSetting } from '../db';
import { getShellEnvironment } from '../environment';
import { getExpandedPath } from '../platform';
import { sanitizeEnv } from '../claude-client/env';

export async function buildClaudeRuntimeEnvironment(provider?: ApiProvider): Promise<Record<string, string>> {
  const shellEnv = await getShellEnvironment();
  const env: Record<string, string> = {
    ...shellEnv,
    HOME: shellEnv.HOME || os.homedir(),
    USERPROFILE: shellEnv.USERPROFILE || os.homedir(),
    PATH: shellEnv.PATH || getExpandedPath(),
  };
  delete env.CLAUDECODE;

  if (provider) {
    for (const key of Object.keys(env)) {
      if (key.startsWith('ANTHROPIC_')) delete env[key];
    }
    if (provider.api_key) {
      env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
      env.ANTHROPIC_API_KEY = provider.api_key;
    }
    if (provider.base_url) env.ANTHROPIC_BASE_URL = provider.base_url;
    try {
      const extraEnv = JSON.parse(provider.extra_env || '{}') as Record<string, unknown>;
      for (const [key, value] of Object.entries(extraEnv)) {
        if (typeof value !== 'string') continue;
        if (value) env[key] = value;
        else delete env[key];
      }
    } catch {
      // The provider form validates this payload. Ignore stale malformed values here.
    }
  } else {
    const storedToken = getSetting('anthropic_auth_token');
    const storedBaseUrl = getSetting('anthropic_base_url');
    const authMode = inferAssistantAuthMode({
      storedMode: getSetting(CLAUDE_AUTH_MODE_KEY),
      storedToken,
      storedBaseUrl,
      envToken: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN,
      envBaseUrl: env.ANTHROPIC_BASE_URL,
    });
    if (authMode === 'login') {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_BASE_URL;
    } else {
      if (storedToken) {
        env.ANTHROPIC_AUTH_TOKEN = storedToken;
        env.ANTHROPIC_API_KEY = storedToken;
      }
      if (storedBaseUrl) env.ANTHROPIC_BASE_URL = storedBaseUrl;
    }
  }

  return sanitizeEnv(env);
}
