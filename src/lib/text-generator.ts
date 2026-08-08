import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { getDb } from '@/lib/db';
import type { ApiProvider } from '@/types';

export interface StreamTextParams {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

/**
 * Resolve a provider from DB by ID. Falls back to the default provider if not found.
 */
function resolveProvider(providerId: string): ApiProvider | undefined {
  const db = getDb();

  // Try the specified provider first
  let provider = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(providerId) as ApiProvider | undefined;
  if (provider && provider.api_key) return provider;

  // Fallback: get the default provider
  const defaultId = db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'").get() as { value: string } | undefined;
  if (defaultId?.value) {
    provider = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(defaultId.value) as ApiProvider | undefined;
    if (provider && provider.api_key) return provider;
  }

  // Last resort: any provider with an API key (excluding gemini-image)
  return db.prepare(
    "SELECT * FROM api_providers WHERE api_key != '' AND provider_type != 'gemini-image' ORDER BY sort_order ASC LIMIT 1"
  ).get() as ApiProvider | undefined;
}

/**
 * Create an AI SDK language model instance from a provider config.
 */
function createLanguageModel(provider: ApiProvider, modelId: string) {
  const providerType = provider.provider_type;

  if (providerType === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: provider.api_key,
      baseURL: provider.base_url || undefined,
    });
    return anthropic(modelId);
  }

  if (providerType === 'gemini-image') {
    // Gemini providers can also do text generation
    const google = createGoogleGenerativeAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url || undefined,
    });
    return google(modelId);
  }

  if (providerType === 'openrouter') {
    // OpenRouter uses OpenAI-compatible API
    const openrouter = createOpenAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url || 'https://openrouter.ai/api/v1',
    });
    return openrouter(modelId);
  }

  // custom, bedrock, vertex — use OpenAI-compatible endpoint
  if (provider.base_url) {
    const custom = createOpenAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
    });
    return custom(modelId);
  }

  throw new Error(`Unsupported provider type "${providerType}" or missing base_url for custom provider.`);
}

/**
 * Stream text from the user's current provider.
 * Returns an async iterable of text chunks.
 */
export async function* streamTextFromProvider(params: StreamTextParams): AsyncIterable<string> {
  const provider = resolveProvider(params.providerId);
  if (!provider) {
    throw new Error('No text generation provider available. Please configure a provider in Settings.');
  }

  const model = createLanguageModel(provider, params.model);

  const result = streamText({
    model,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Useful when you need the full response as a string.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamTextFromProvider(params)) {
    chunks.push(chunk);
  }
  return chunks.join('');
}
