import { NextResponse } from 'next/server';

import { loadClaudeModelCatalog, loadCodexModelCatalog } from '@/lib/assistant-model-catalog';
import { getAllProviders, getDefaultProviderId } from '@/lib/db';
import type {
  AssistantModelOption,
  ErrorResponse,
  ProviderModelGroup,
} from '@/types';

type LooseRecord = Record<string, unknown>;

function splitModelList(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeModelOptions(rawModels: string[]): AssistantModelOption[] {
  const seen = new Set<string>();
  const result: AssistantModelOption[] = [];
  for (const item of rawModels) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push({ value: item, label: item });
  }
  return result;
}

function parseConfiguredModels(envSource: LooseRecord): AssistantModelOption[] {
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
        if (typeof item === 'string' && item.trim()) rawModels.push(item.trim());
      }
    } else if (typeof value === 'string' && value.trim()) {
      rawModels.push(...splitModelList(value));
    }
  }

  return normalizeModelOptions(rawModels);
}

function parseConfiguredModelsFromExtraEnv(extraEnvRaw: string | undefined | null): AssistantModelOption[] {
  try {
    return parseConfiguredModels(JSON.parse(extraEnvRaw || '{}') as LooseRecord);
  } catch {
    return [];
  }
}

function mergeModels(...lists: AssistantModelOption[][]): AssistantModelOption[] {
  const seen = new Set<string>();
  const result: AssistantModelOption[] = [];
  for (const models of lists) {
    for (const model of models) {
      if (!model.value || seen.has(model.value)) continue;
      seen.add(model.value);
      result.push(model);
    }
  }
  return result;
}

export async function GET() {
  try {
    const providers = getAllProviders();
    const mediaProviderTypes = new Set(['gemini-image']);
    const chatProviders = providers.filter((provider) => !mediaProviderTypes.has(provider.provider_type));
    const [claudeCatalog, codexCatalog, ...providerCatalogs] = await Promise.all([
      loadClaudeModelCatalog(),
      loadCodexModelCatalog(),
      ...chatProviders.map((provider) => loadClaudeModelCatalog(provider)),
    ]);
    const envConfiguredModels = parseConfiguredModels(process.env as LooseRecord);
    const envModels = mergeModels(envConfiguredModels, claudeCatalog.models);
    const groups: ProviderModelGroup[] = [{
      provider_id: 'env',
      provider_name: 'Claude Code',
      provider_type: 'anthropic',
      models: envModels,
      default_model: envConfiguredModels[0]?.value || claudeCatalog.defaultModel,
      ...(claudeCatalog.error ? { error: claudeCatalog.error } : {}),
    }];

    chatProviders.forEach((provider, index) => {
      const configuredModels = parseConfiguredModelsFromExtraEnv(provider.extra_env);
      const catalog = providerCatalogs[index];
      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        models: mergeModels(configuredModels, catalog?.models || []),
        default_model: configuredModels[0]?.value || catalog?.defaultModel || '',
        ...(catalog?.error ? { error: catalog.error } : {}),
      });
    });

    return NextResponse.json({
      groups,
      default_provider_id: getDefaultProviderId() || groups[0]?.provider_id || 'env',
      codex: {
        models: codexCatalog.models,
        default_model: codexCatalog.defaultModel,
        ...(codexCatalog.error ? { error: codexCatalog.error } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get CLI models' },
      { status: 500 },
    );
  }
}
