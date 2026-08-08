import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthModeSettingKey, inferAssistantAuthMode } from '@/lib/assistant-auth';
import { getAllProviders, getSetting } from '@/lib/db';
import { findClaudeBinary, findCodexBinary, getClaudeVersion, getCodexVersion } from '@/lib/platform';
import type { AssistantRuntime, AssistantRuntimeStatus } from '@/types';
import { SETTING_KEYS } from '@/types';

const VERSION_CACHE_TTL_MS = 5 * 60_000;

type RuntimeVersionCacheEntry = {
  value: string | null;
  expiresAt: number;
};

const runtimeVersionCache = new Map<AssistantRuntime, RuntimeVersionCacheEntry>();

export const assistantRuntimePlatform = {
  findClaudeBinary,
  findCodexBinary,
  getClaudeVersion,
  getCodexVersion,
};

function readEnabledSetting(runtime: AssistantRuntime): boolean {
  const key = runtime === 'claude_code'
    ? SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE
    : SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX;
  return getSetting(key) !== 'false';
}

function hasNonEmptyFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function hasClaudeConfiguration(): boolean {
  const providers = getAllProviders();
  const claudeHome = path.join(os.homedir(), '.claude');
  const hasClaudeLogin = [
    path.join(claudeHome, '.credentials.json'),
    path.join(claudeHome, 'settings.json'),
    path.join(os.homedir(), '.claude.json'),
  ].some((filePath) => hasNonEmptyFile(filePath));
  const appToken = getSetting('anthropic_auth_token');
  const appBaseUrl = getSetting('anthropic_base_url');
  const envToken = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const authMode = inferAssistantAuthMode({
    storedMode: getSetting(getAuthModeSettingKey('claude_code')),
    storedToken: appToken,
    storedBaseUrl: appBaseUrl,
    envToken,
    envBaseUrl,
  });

  if (providers.some((provider) => provider.provider_type !== 'gemini-image' && provider.api_key)) {
    return true;
  }

  if (authMode === 'login') {
    return hasClaudeLogin;
  }

  return Boolean(
    appToken
      || envToken,
  );
}

function hasCodexConfiguration(): boolean {
  const codexAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
  const appToken = getSetting(SETTING_KEYS.CODEX_AUTH_TOKEN);
  const appBaseUrl = getSetting(SETTING_KEYS.CODEX_BASE_URL);
  const envToken = process.env.OPENAI_API_KEY || process.env.CODEX_AUTH_TOKEN || process.env.CODEX_API_KEY;
  const envBaseUrl = process.env.OPENAI_BASE_URL;
  const authMode = inferAssistantAuthMode({
    storedMode: getSetting(getAuthModeSettingKey('codex')),
    storedToken: appToken,
    storedBaseUrl: appBaseUrl,
    envToken,
    envBaseUrl,
  });
  const hasCodexLogin = hasNonEmptyFile(codexAuthPath);

  if (authMode === 'login') {
    return hasCodexLogin;
  }

  return Boolean(
    appToken
      || envToken,
  );
}

function buildAssistantRuntimeStatus(runtime: AssistantRuntime): AssistantRuntimeStatus {
  if (runtime === 'claude_code') {
    const installed = Boolean(assistantRuntimePlatform.findClaudeBinary());
    const enabled = readEnabledSetting('claude_code');
    const configured = hasClaudeConfiguration();
    return {
      id: 'claude_code',
      label: 'Claude Code',
      enabled,
      installed,
      configured,
      available: enabled && installed && configured,
      supports_plan_mode: true,
      supports_permissions: true,
      status_message: !enabled
        ? '设置中已禁用 / Disabled in settings'
        : !installed
        ? '未安装 Claude Code CLI / Claude Code CLI is not installed'
        : !configured
        ? '请先登录 Claude Code，或配置 Claude Provider / Anthropic 授权令牌 / Run claude login, or configure a Claude provider / Anthropic auth token'
        : undefined,
    };
  }

  const installed = Boolean(assistantRuntimePlatform.findCodexBinary());
  const enabled = readEnabledSetting('codex');
  const configured = hasCodexConfiguration();
  return {
    id: 'codex',
    label: 'Codex',
    enabled,
    installed,
    configured,
    available: enabled && installed && configured,
    supports_plan_mode: true,
    supports_permissions: false,
    status_message: !enabled
      ? '设置中已禁用 / Disabled in settings'
      : !installed
      ? '未安装 Codex CLI / Codex CLI is not installed'
      : !configured
      ? '请先运行 codex login，或在设置中配置 Codex API Key / Run codex login, or configure Codex API key in Settings'
      : undefined,
  };
}

export function getDefaultAssistantRuntime(): AssistantRuntime {
  const value = getSetting(SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME);
  return value === 'codex' ? 'codex' : 'claude_code';
}

export async function getPreferredAvailableAssistantRuntime(
  preferredRuntime?: AssistantRuntime,
): Promise<AssistantRuntime | null> {
  const statuses = await listAssistantRuntimes();
  const preferred = preferredRuntime
    ? statuses.find((status) => status.id === preferredRuntime)
    : null;
  if (preferred?.available) {
    return preferred.id;
  }

  const defaultRuntime = getDefaultAssistantRuntime();
  const defaultStatus = statuses.find((status) => status.id === defaultRuntime);
  if (defaultStatus?.available) {
    return defaultStatus.id;
  }

  const fallback = statuses.find((status) => status.available);
  return fallback?.id ?? null;
}

export async function listAssistantRuntimes(): Promise<AssistantRuntimeStatus[]> {
  return [
    buildAssistantRuntimeStatus('claude_code'),
    buildAssistantRuntimeStatus('codex'),
  ];
}

export async function getAssistantRuntimeVersion(runtime: AssistantRuntime): Promise<string | null> {
  const cached = runtimeVersionCache.get(runtime);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let version: string | null;
  if (runtime === 'claude_code') {
    const binary = assistantRuntimePlatform.findClaudeBinary();
    version = binary ? await assistantRuntimePlatform.getClaudeVersion(binary) : null;
  } else {
    const binary = assistantRuntimePlatform.findCodexBinary();
    version = binary ? await assistantRuntimePlatform.getCodexVersion(binary) : null;
  }

  runtimeVersionCache.set(runtime, {
    value: version,
    expiresAt: now + VERSION_CACHE_TTL_MS,
  });
  return version;
}

export async function getAssistantRuntimeStatus(runtime: AssistantRuntime): Promise<AssistantRuntimeStatus | null> {
  return buildAssistantRuntimeStatus(runtime);
}
