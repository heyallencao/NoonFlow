import os from 'node:os';

import { CODEX_AUTH_MODE_KEY, inferAssistantAuthMode } from '../assistant-auth';
import { getSetting } from '../db';
import { getShellEnvironment } from '../environment';
import { getExpandedPath } from '../platform';
import { SETTING_KEYS } from '@/types';

export interface CodexRuntimeSettings {
  env: NodeJS.ProcessEnv;
  apiKey?: string;
  baseUrl?: string;
}

export async function buildCodexRuntimeSettings(): Promise<CodexRuntimeSettings> {
  const shellEnv = await getShellEnvironment();
  const env: NodeJS.ProcessEnv = {
    ...shellEnv,
    HOME: shellEnv.HOME || os.homedir(),
    PATH: shellEnv.PATH || getExpandedPath(),
    NODE_ENV: process.env.NODE_ENV as 'development' | 'production' | 'test',
  };

  const apiKey = getSetting(SETTING_KEYS.CODEX_AUTH_TOKEN) || undefined;
  const baseUrl = getSetting(SETTING_KEYS.CODEX_BASE_URL) || undefined;
  const codexExtraEnv = getSetting(SETTING_KEYS.CODEX_EXTRA_ENV);
  const authMode = inferAssistantAuthMode({
    storedMode: getSetting(CODEX_AUTH_MODE_KEY),
    storedToken: apiKey,
    storedBaseUrl: baseUrl,
    envToken: env.OPENAI_API_KEY || env.CODEX_AUTH_TOKEN || env.CODEX_API_KEY,
    envBaseUrl: env.OPENAI_BASE_URL,
  });

  if (authMode === 'login') {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.CODEX_AUTH_TOKEN;
    delete env.OPENAI_BASE_URL;
  } else {
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
      env.CODEX_AUTH_TOKEN = apiKey;
    }
    if (baseUrl) {
      env.OPENAI_BASE_URL = baseUrl;
    }
  }

  if (codexExtraEnv) {
    try {
      const parsed = JSON.parse(codexExtraEnv) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          if (value) env[key] = value;
          else delete env[key];
        }
      }
    } catch {
      // The settings UI validates this payload. Ignore stale malformed values here.
    }
  }

  return {
    env,
    apiKey: authMode === 'api_key' ? apiKey : undefined,
    baseUrl: authMode === 'api_key' ? baseUrl : undefined,
  };
}
