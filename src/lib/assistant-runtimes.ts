import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthModeSettingKey, inferAssistantAuthMode } from '@/lib/assistant-auth';
import { getAllProviders, getSetting } from '@/lib/db';
import { findClaudeBinary, findCodexBinary, findPiBinary, getClaudeVersion, getCodexVersion, getPiVersion, listPiModels } from '@/lib/platform';
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
  findPiBinary,
  getPiVersion,
  listPiModels,
  hasPiConfiguration,
};

function readEnabledSetting(runtime: AssistantRuntime): boolean {
  const key = runtime === 'claude_code'
    ? SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE
    : runtime === 'codex'
    ? SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX
    : SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_PI;
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

const PI_API_KEY_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANT_LING_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'NVIDIA_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_API_KEY',
  'ZAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
  'OPENCODE_API_KEY',
  'HF_TOKEN',
  'FIREWORKS_API_KEY',
  'TOGETHER_API_KEY',
  'BASETEN_API_KEY',
  'KIMI_API_KEY',
  'MOONSHOT_API_KEY',
  'MINIMAX_API_KEY',
  'CLOUDFLARE_API_KEY',
  'QWEN_TOKEN_PLAN_API_KEY',
  'QWEN_TOKEN_PLAN_CN_API_KEY',
  'XIAOMI_API_KEY',
  'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  'AWS_PROFILE',
  'AWS_ACCESS_KEY_ID',
  'AWS_BEARER_TOKEN_BEDROCK',
] as const;

function hasPiConfiguration(): boolean {
  const configuredAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configuredAgentDir
    ? configuredAgentDir.replace(/^~(?=$|[\\/])/, os.homedir())
    : path.join(os.homedir(), '.pi', 'agent');
  if (hasNonEmptyFile(path.join(agentDir, 'auth.json'))) {
    return true;
  }
  return PI_API_KEY_ENV_VARS.some((name) => Boolean(process.env[name]));
}

function buildAssistantRuntimeStatus(runtime: Exclude<AssistantRuntime, 'pi'>): AssistantRuntimeStatus {
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
      launchable: enabled && installed,
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
    launchable: enabled && installed,
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

async function buildPiRuntimeStatus(): Promise<AssistantRuntimeStatus> {
  const binary = assistantRuntimePlatform.findPiBinary();
  const installed = Boolean(binary);
  const enabled = readEnabledSetting('pi');
  const probe = binary ? await assistantRuntimePlatform.listPiModels(binary) : { models: [] };
  const configured = probe.models.length > 0 || assistantRuntimePlatform.hasPiConfiguration();
  return {
    id: 'pi',
    label: 'Pi',
    enabled,
    installed,
    configured,
    // Pi can be configured through project providers/extensions that are only
    // visible after cwd/trust resolution. Do not turn a global heuristic into
    // a hard session-creation gate; the runtime will return the precise error.
    launchable: enabled && installed,
    available: enabled && installed && configured,
    supports_plan_mode: true,
    supports_permissions: false,
    status_message: !enabled
      ? '设置中已禁用 / Disabled in settings'
      : !installed
      ? '未安装 Pi CLI / Pi CLI is not installed'
      : !configured
      ? 'Pi 已安装；请运行 pi 后使用 /login 配置模型 / Pi is installed; run pi and use /login to configure a model'
      : undefined,
  };
}

export function getDefaultAssistantRuntime(): AssistantRuntime {
  const value = getSetting(SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME);
  return value === 'codex' || value === 'pi' ? value : 'claude_code';
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
  const statuses = await Promise.all([
    buildAssistantRuntimeStatus('claude_code'),
    buildAssistantRuntimeStatus('codex'),
    buildPiRuntimeStatus(),
  ]);
  const versions = await Promise.all(statuses.map((status) => getAssistantRuntimeVersion(status.id)));
  return statuses.map((status, index) => ({
    ...status,
    ...(versions[index] ? { version: versions[index] || undefined } : {}),
  }));
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
  } else if (runtime === 'codex') {
    const binary = assistantRuntimePlatform.findCodexBinary();
    version = binary ? await assistantRuntimePlatform.getCodexVersion(binary) : null;
  } else {
    const binary = assistantRuntimePlatform.findPiBinary();
    version = binary ? await assistantRuntimePlatform.getPiVersion(binary) : null;
  }

  runtimeVersionCache.set(runtime, {
    value: version,
    expiresAt: now + VERSION_CACHE_TTL_MS,
  });
  return version;
}

export async function getAssistantRuntimeStatus(runtime: AssistantRuntime): Promise<AssistantRuntimeStatus | null> {
  return runtime === 'pi' ? buildPiRuntimeStatus() : buildAssistantRuntimeStatus(runtime);
}
