import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, Query } from '@anthropic-ai/claude-agent-sdk';

import { SETTING_KEYS, type ApiProvider, type AssistantModelOption } from '@/types';
import { CLAUDE_AUTH_MODE_KEY, CODEX_AUTH_MODE_KEY } from './assistant-auth';
import { getSetting } from './db';
import { findClaudePath, resolveScriptFromCmd } from './claude-client/env';
import { buildClaudeRuntimeEnvironment } from './claude/runtime-settings';
import { CodexAppServerClient } from './codex/app-server';
import { buildCodexRuntimeSettings } from './codex/runtime-settings';
import { findCodexBinary } from './platform';

export interface AssistantModelCatalog {
  models: AssistantModelOption[];
  defaultModel: string;
  error?: string;
}

type ClaudeQueryFactory = typeof query;
type ClaudeModelCatalogLoader = (provider?: ApiProvider) => Promise<AssistantModelCatalog>;
type CodexModelCatalogLoader = () => Promise<AssistantModelCatalog>;

const MODEL_CATALOG_TTL_MS = 30_000;
const MODEL_PROBE_TIMEOUT_MS = 15_000;
const claudeCatalogCache = new Map<string, { expiresAt: number; value: AssistantModelCatalog }>();
const claudeCatalogInFlight = new Map<string, Promise<AssistantModelCatalog>>();
let codexCatalogCache: { key: string; expiresAt: number; value: AssistantModelCatalog } | null = null;
let codexCatalogInFlight: Promise<AssistantModelCatalog> | null = null;
let claudeQueryFactory: ClaudeQueryFactory = query;
let claudeLoaderOverride: ClaudeModelCatalogLoader | null = null;
let codexLoaderOverride: CodexModelCatalogLoader | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), MODEL_PROBE_TIMEOUT_MS);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function normalizeClaudeModels(models: ModelInfo[]): AssistantModelOption[] {
  const seen = new Set<string>();
  const result: AssistantModelOption[] = [];
  for (const model of models) {
    const value = model.value?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({
      value,
      label: model.displayName?.trim() || value,
      ...(model.description?.trim() ? { description: model.description.trim() } : {}),
      ...(model.supportedEffortLevels?.length
        ? { supportedEffortLevels: [...model.supportedEffortLevels] }
        : {}),
    });
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeCodexModels(value: unknown): AssistantModelCatalog {
  const payload = asRecord(value);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const models: AssistantModelOption[] = [];
  const seen = new Set<string>();
  let defaultModel = '';

  for (const rowValue of rows) {
    const row = asRecord(rowValue);
    if (!row) continue;
    const model = typeof row.model === 'string' && row.model.trim()
      ? row.model.trim()
      : typeof row.id === 'string'
        ? row.id.trim()
        : '';
    if (!model || seen.has(model)) continue;
    seen.add(model);

    const effortRows = Array.isArray(row.supportedReasoningEfforts)
      ? row.supportedReasoningEfforts
      : [];
    const supportedEffortLevels = effortRows
      .map((effort) => asRecord(effort)?.reasoningEffort)
      .filter((effort): effort is string => typeof effort === 'string' && Boolean(effort.trim()))
      .map((effort) => effort.trim());
    const isDefault = row.isDefault === true;
    if (isDefault) defaultModel = model;
    models.push({
      value: model,
      label: typeof row.displayName === 'string' && row.displayName.trim()
        ? row.displayName.trim()
        : model,
      ...(typeof row.description === 'string' && row.description.trim()
        ? { description: row.description.trim() }
        : {}),
      ...(isDefault ? { isDefault: true } : {}),
      ...(supportedEffortLevels.length > 0 ? { supportedEffortLevels } : {}),
      ...(typeof row.defaultReasoningEffort === 'string' && row.defaultReasoningEffort.trim()
        ? { defaultEffort: row.defaultReasoningEffort.trim() }
        : {}),
    });
  }

  return { models, defaultModel: defaultModel || models[0]?.value || '' };
}

async function probeClaudeModels(provider?: ApiProvider): Promise<AssistantModelCatalog> {
  const detectedPath = findClaudePath();
  if (!detectedPath) return { models: [], defaultModel: '', error: 'Claude Code CLI not found' };

  let executablePath = detectedPath;
  if (/\.(cmd|bat)$/i.test(path.extname(detectedPath))) {
    const resolved = resolveScriptFromCmd(detectedPath);
    if (!resolved) {
      return { models: [], defaultModel: '', error: 'Claude Code CLI wrapper could not be resolved' };
    }
    executablePath = resolved;
  }

  let claudeQuery: Query | null = null;
  try {
    claudeQuery = claudeQueryFactory({
      prompt: '',
      options: {
        cwd: os.homedir(),
        env: await buildClaudeRuntimeEnvironment(provider),
        pathToClaudeCodeExecutable: executablePath,
        settingSources: ['user', 'project', 'local'],
        tools: [],
      },
    });
    const models = normalizeClaudeModels(
      await withTimeout(claudeQuery.supportedModels(), 'Claude Code model discovery'),
    );
    return { models, defaultModel: models[0]?.value || '' };
  } catch (error) {
    return { models: [], defaultModel: '', error: errorMessage(error) };
  } finally {
    claudeQuery?.close();
  }
}

async function probeCodexModels(): Promise<AssistantModelCatalog> {
  const binary = findCodexBinary();
  if (!binary) return { models: [], defaultModel: '', error: 'Codex CLI not found' };
  const settings = await buildCodexRuntimeSettings();
  const client = new CodexAppServerClient({
    executablePath: binary,
    cwd: os.homedir(),
    env: settings.env,
    onNotification: () => {},
    onServerRequest: () => ({}),
  });

  try {
    await withTimeout(client.start(), 'Codex model discovery');
    const allModels: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page: Record<string, unknown> = await withTimeout(
        client.request<Record<string, unknown>>('model/list', {
          cursor,
          limit: 100,
          includeHidden: false,
        }),
        'Codex model discovery',
      );
      if (Array.isArray(page.data)) allModels.push(...page.data);
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    } while (cursor);
    return normalizeCodexModels({ data: allModels });
  } catch (error) {
    return { models: [], defaultModel: '', error: errorMessage(error) };
  } finally {
    client.stop();
  }
}

function claudeCacheKey(provider?: ApiProvider): string {
  if (provider) return `${provider.id}:${provider.updated_at}:${provider.base_url}`;
  return createHash('sha256').update(JSON.stringify({
    binary: findClaudePath() || '',
    authMode: getSetting(CLAUDE_AUTH_MODE_KEY),
    hasToken: Boolean(getSetting('anthropic_auth_token')),
    baseUrl: getSetting('anthropic_base_url'),
  })).digest('hex');
}

export async function loadClaudeModelCatalog(provider?: ApiProvider): Promise<AssistantModelCatalog> {
  if (claudeLoaderOverride) return claudeLoaderOverride(provider);
  const key = claudeCacheKey(provider);
  const now = Date.now();
  const cached = claudeCatalogCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const existing = claudeCatalogInFlight.get(key);
  if (existing) return existing;

  const pending = probeClaudeModels(provider).then((value) => {
    claudeCatalogCache.set(key, { value, expiresAt: Date.now() + MODEL_CATALOG_TTL_MS });
    return value;
  }).finally(() => claudeCatalogInFlight.delete(key));
  claudeCatalogInFlight.set(key, pending);
  return pending;
}

export async function loadCodexModelCatalog(): Promise<AssistantModelCatalog> {
  if (codexLoaderOverride) return codexLoaderOverride();
  const binary = findCodexBinary() || '';
  const key = createHash('sha256').update(JSON.stringify({
    binary,
    authMode: getSetting(CODEX_AUTH_MODE_KEY),
    hasToken: Boolean(getSetting(SETTING_KEYS.CODEX_AUTH_TOKEN)),
    baseUrl: getSetting(SETTING_KEYS.CODEX_BASE_URL),
    extraEnv: getSetting(SETTING_KEYS.CODEX_EXTRA_ENV),
  })).digest('hex');
  const now = Date.now();
  if (codexCatalogCache && codexCatalogCache.key === key && codexCatalogCache.expiresAt > now) {
    return codexCatalogCache.value;
  }
  if (codexCatalogInFlight) return codexCatalogInFlight;

  codexCatalogInFlight = probeCodexModels().then((value) => {
    codexCatalogCache = { key, value, expiresAt: Date.now() + MODEL_CATALOG_TTL_MS };
    return value;
  }).finally(() => {
    codexCatalogInFlight = null;
  });
  return codexCatalogInFlight;
}

export function __setAssistantModelCatalogLoadersForTests(overrides: {
  claude?: ClaudeModelCatalogLoader | null;
  codex?: CodexModelCatalogLoader | null;
  claudeQuery?: ClaudeQueryFactory | null;
}): void {
  if ('claude' in overrides) claudeLoaderOverride = overrides.claude ?? null;
  if ('codex' in overrides) codexLoaderOverride = overrides.codex ?? null;
  if ('claudeQuery' in overrides) claudeQueryFactory = overrides.claudeQuery ?? query;
  claudeCatalogCache.clear();
  claudeCatalogInFlight.clear();
  codexCatalogCache = null;
  codexCatalogInFlight = null;
}
