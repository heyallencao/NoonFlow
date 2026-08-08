import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId } from '@/lib/db';
import type { ErrorResponse, ProviderModelGroup } from '@/types';

// Default Claude model options
const DEFAULT_MODELS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// Provider-specific model label mappings (base_url -> alias -> display name)
const PROVIDER_MODEL_LABELS: Record<string, { value: string; label: string }[]> = {
  'https://api.z.ai/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-5' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://open.bigmodel.cn/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-5' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://api.kimi.com/coding': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.ai/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.cn/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://openrouter.ai/api': [
    { value: 'sonnet', label: 'Sonnet 4.6' },
    { value: 'opus', label: 'Opus 4.6' },
    { value: 'haiku', label: 'Haiku 4.5' },
  ],
  'https://coding.dashscope.aliyuncs.com/apps/anthropic': [
    { value: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
    { value: 'qwen3-coder-next', label: 'Qwen 3 Coder Next' },
    { value: 'qwen3-coder-plus', label: 'Qwen 3 Coder Plus' },
    { value: 'kimi-k2.5', label: 'Kimi K2.5' },
    { value: 'glm-5', label: 'GLM-5' },
    { value: 'glm-4.7', label: 'GLM-4.7' },
    { value: 'MiniMax-M2.5', label: 'MiniMax-M2.5' },
  ],
  'https://api.minimaxi.com/anthropic': [
    { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
    { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7 Highspeed' },
  ],
  'https://api.minimax.io/anthropic': [
    { value: 'MiniMax-M2.7', label: 'MiniMax-M2.7' },
    { value: 'MiniMax-M2.7-highspeed', label: 'MiniMax-M2.7 Highspeed' },
  ],
};

type ModelOption = { value: string; label: string };
type LooseRecord = Record<string, unknown>;

function normalizeBaseUrl(baseUrl: string | undefined | null): string {
  return (baseUrl || '').trim().toLowerCase().replace(/\/+$/, '');
}

function splitModelList(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeModelOptions(rawModels: string[]): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const item of rawModels) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push({ value: item, label: item });
  }
  return result;
}

function parseConfiguredModels(envSource: LooseRecord): ModelOption[] {
  const rawModels: string[] = [];

  const singleModel = envSource.ANTHROPIC_MODEL;
  if (typeof singleModel === 'string' && singleModel.trim()) {
    rawModels.push(singleModel.trim());
  }

  const listKeys = ['NOONFLOW_PROVIDER_MODELS', 'MONOLITH_PROVIDER_MODELS', 'ANTHROPIC_MODELS', 'MODEL_NAMES'] as const;
  for (const key of listKeys) {
    const value = envSource[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          rawModels.push(item.trim());
        }
      }
    } else if (typeof value === 'string' && value.trim()) {
      rawModels.push(...splitModelList(value));
    }
  }

  return normalizeModelOptions(rawModels);
}

function parseConfiguredModelsFromExtraEnv(extraEnvRaw: string | undefined | null): ModelOption[] {
  try {
    const envObj = JSON.parse(extraEnvRaw || '{}') as LooseRecord;
    return parseConfiguredModels(envObj);
  } catch {
    return [];
  }
}

/**
 * Deduplicate models: if multiple aliases map to the same label, keep only the first one.
 */
function deduplicateModels(models: { value: string; label: string }[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const result: { value: string; label: string }[] = [];
  for (const m of models) {
    if (!seen.has(m.label)) {
      seen.add(m.label);
      result.push(m);
    }
  }
  return result;
}

export async function GET() {
  try {
    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];
    const envConfiguredModels = parseConfiguredModels(process.env as LooseRecord);

    // Always show the built-in Claude Code provider group.
    // Claude Code CLI stores credentials in ~/.claude/ (via `claude login`),
    // which the SDK subprocess can read — even without ANTHROPIC_API_KEY in env.
    groups.push({
      provider_id: 'env',
      provider_name: 'Claude Code',
      provider_type: 'anthropic',
      models: envConfiguredModels.length > 0 ? envConfiguredModels : DEFAULT_MODELS,
    });

    // Provider types that are not LLMs (e.g. image generation) — skip in chat model selector
    const MEDIA_PROVIDER_TYPES = new Set(['gemini-image']);

    // Build a group for each configured provider
    for (const provider of providers) {
      if (MEDIA_PROVIDER_TYPES.has(provider.provider_type)) continue;
      const configuredModels = parseConfiguredModelsFromExtraEnv(provider.extra_env);
      const matched = PROVIDER_MODEL_LABELS[normalizeBaseUrl(provider.base_url)];
      const rawModels = configuredModels.length > 0
        ? configuredModels
        : (matched || DEFAULT_MODELS);

      const models = deduplicateModels(rawModels);

      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        models,
      });
    }

    // Determine default provider
    const defaultProviderId = getDefaultProviderId() || groups[0].provider_id;

    return NextResponse.json({
      groups,
      default_provider_id: defaultProviderId,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 }
    );
  }
}
