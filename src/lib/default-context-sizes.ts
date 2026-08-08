/**
 * Default context window sizes per model.
 *
 * These are based on official model documentation checked on 2026-04-11.
 * Users can override these in the app settings if their provider uses different values.
 *
 * Source:
 * - Anthropic model documentation
 * - OpenAI GPT-5 / GPT-5.2-Codex model pages
 */

export const DEFAULT_CONTEXT_SIZE_FALLBACK = 200_000;

export const DEFAULT_CONTEXT_SIZES: Record<string, number> = {
  // ── Claude 4.6 series (20250514) ──────────────────────────────
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-6': 200_000,

  // ── Claude 4.5 series ─────────────────────────────────────────
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5': 200_000,

  // ── Claude 4 series (20250514) ────────────────────────────────
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-20250414': 200_000,

  // ── Claude 4.1 series ─────────────────────────────────────────
  'claude-opus-4-1': 200_000,
  'claude-opus-4-1-20250805': 200_000,

  // ── Claude 3.7 / 3.5 series ──────────────────────────────────
  'claude-sonnet-3-7': 200_000,
  'claude-sonnet-3-7-20250219': 200_000,
  'claude-sonnet-3-5': 200_000,
  'claude-sonnet-3-5-20241022': 200_000,
  'claude-opus-3-5': 200_000,
  'claude-opus-3-5-20241022': 200_000,
  'claude-haiku-3-5': 200_000,
  'claude-haiku-3-5-20241022': 200_000,

  // ── Claude 3 series ──────────────────────────────────────────
  'claude-opus-3': 200_000,
  'claude-opus-3-20240229': 200_000,
  'claude-sonnet-3': 200_000,
  'claude-sonnet-3-20240229': 200_000,
  'claude-haiku-3': 200_000,

  // ── OpenAI GPT-5 / Codex family ──────────────────────────────
  'gpt-5-chat-latest': 128_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.5-pro': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-pro': 1_050_000,
  'gpt-5.4-mini': 400_000,
  'gpt-5.3-codex': 400_000,
  'gpt-5.2': 400_000,
  'gpt-5.2-codex': 400_000,
  'gpt-5.2-pro': 400_000,
  'gpt-5.1': 400_000,
  'gpt-5.1-codex': 400_000,
  'gpt-5.1-codex-max': 400_000,
  'gpt-5': 400_000,
  'gpt-5-codex': 400_000,
  'gpt-5-mini': 400_000,
  'gpt-5-nano': 400_000,
  'codex': 400_000,

  // ── Google Gemini family ─────────────────────────────────────
  'gemini-3.1-pro': 2_000_000,
  'gemini-3.1-pro-latest': 2_000_000,
  'gemini-3-flash': 1_000_000,
  'gemini-3-flash-latest': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-pro': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-flash-lite': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
  'gemini-pro': 2_000_000,
  'gemini': 2_000_000,

  // ── MiniMax ──────────────────────────────────────────────────
  'minimax-m1': 1_000_000,
  'minimax-m2.7': 204_800,
  'minimax-m2': 204_800,
  'minimax-text-01': 1_000_000,

  // ── 阿里巴巴 Qwen family ──────────────────────────────────────
  'qwen-3.5-max': 1_000_000,
  'qwen-3.5-plus': 1_000_000,
  'qwen-3.5-turbo': 1_000_000,
  'qwen-3.5-coder': 1_000_000,
  'qwen3': 1_000_000,
  'qwen2.5': 1_000_000,
  'qwen2.5-coder': 1_000_000,
  'qwen-max': 262_144,
  'qwen-plus': 262_144,
  'qwen-turbo': 262_144,

  // ── 月之暗面 Kimi family ──────────────────────────────────────
  'kimi-k2.5': 2_000_000,
  'kimi-k2': 2_000_000,
  'kimi-k1.6': 256_000,
  'kimi-k1.5': 256_000,
  'kimi-latest': 256_000,
  'kimi': 256_000,

  // ── 深度求索 DeepSeek family ─────────────────────────────────
  'deepseek-r1': 164_000,
  'deepseek-v3': 128_000,
  'deepseek-v2.5': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-coder': 128_000,
  'deepseek': 128_000,

  // ── 智谱 AI GLM family ───────────────────────────────────────
  'glm-5': 204_800,
  'glm-5-reasoning': 204_800,
  'glm-4.5': 204_800,
  'glm-4.5-air': 204_800,
  'glm-4.5-flash': 204_800,
  'glm-4': 204_800,
  'glm-4-air': 204_800,
  'glm-4-flash': 204_800,
  'glm-4-long': 2_000_000,
  'glm': 204_800,
};

const GENERIC_MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  'opus-4-6': 'claude-opus-4-6',
  'sonnet-4-6': 'claude-sonnet-4-6',
  'haiku-4-5': 'claude-haiku-4-5',
  'qwen3.5-max': 'qwen-3.5-max',
  'qwen3.5-plus': 'qwen-3.5-plus',
  'qwen3.5-coder': 'qwen-3.5-coder',
  'minimax-m2.7-highspeed': 'minimax-m2.7',
};

const LABEL_MODEL_ALIASES: Record<string, string> = {
  'opus-4.6': 'claude-opus-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'haiku-4.5': 'claude-haiku-4-5',
  'claude-4.6-opus': 'claude-opus-4-6',
  'claude-4.6-sonnet': 'claude-sonnet-4-6',
  'claude-4.5-haiku': 'claude-haiku-4-5',
  'kimi-k2.5': 'kimi-k2.5',
  'kimi-k2': 'kimi-k2',
  'kimi-k1.6': 'kimi-k1.6',
  'glm-5': 'glm-5',
  'glm-5-reasoning': 'glm-5-reasoning',
  'glm-4.7': 'glm',
  'glm-4.5': 'glm-4.5',
  'glm-4.5-air': 'glm-4.5-air',
  'minimax-m1': 'minimax-m1',
  'minimax-m2.7': 'minimax-m2.7',
  'minimax-m2.7-highspeed': 'minimax-m2.7',
  'minimax-m2.5': 'minimax-m2',
  'qwen-3.5-max': 'qwen-3.5-max',
  'qwen-3.5-plus': 'qwen-3.5-plus',
  'qwen-3.5-coder': 'qwen-3.5-coder',
};

const KNOWN_MODEL_FAMILY_PREFIXES = [
  'claude-',
  'gpt-',
  'gemini-',
  'minimax-',
  'qwen-',
  'qwen3.5-',
  'qwen3-',
  'kimi-',
  'deepseek-',
  'glm-',
  'codex',
] as const;

function normalizeContextLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/\/+$/g, '')
    .replace(/-+/g, '-');
}

function stripLabelMetadata(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function extractKnownModelFragment(value: string): string | null {
  const normalized = normalizeContextLookupKey(value);
  let bestMatch: string | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const prefix of KNOWN_MODEL_FAMILY_PREFIXES) {
    const index = normalized.indexOf(prefix);
    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
      bestMatch = normalized.slice(index);
    }
  }

  return bestMatch && bestMatch !== normalized ? bestMatch : null;
}

function addLookupCandidate(
  candidates: string[],
  seen: Set<string>,
  value: string | null | undefined,
): void {
  if (!value) {
    return;
  }

  const normalized = normalizeContextLookupKey(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  candidates.push(normalized);
}

function buildExplicitModelLookupCandidates(model: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedModel = normalizeContextLookupKey(model);

  addLookupCandidate(candidates, seen, normalizedModel);
  addLookupCandidate(candidates, seen, extractKnownModelFragment(normalizedModel));

  return candidates;
}

function buildGenericAliasLookupCandidates(model: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedModel = normalizeContextLookupKey(model);

  addLookupCandidate(candidates, seen, GENERIC_MODEL_ALIASES[normalizedModel]);

  return candidates;
}

function buildModelLookupCandidates(model: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const candidate of buildExplicitModelLookupCandidates(model)) {
    addLookupCandidate(candidates, seen, candidate);
  }
  for (const candidate of buildGenericAliasLookupCandidates(model)) {
    addLookupCandidate(candidates, seen, candidate);
  }

  return candidates;
}

function buildLabelLookupCandidates(modelLabel: string | undefined): string[] {
  if (!modelLabel) {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedLabel = normalizeContextLookupKey(stripLabelMetadata(modelLabel));

  addLookupCandidate(candidates, seen, normalizedLabel);
  addLookupCandidate(candidates, seen, LABEL_MODEL_ALIASES[normalizedLabel]);
  addLookupCandidate(candidates, seen, extractKnownModelFragment(normalizedLabel));

  return candidates;
}

function findBestContextSizeMatch(
  candidates: string[],
  sizes: Record<string, number>,
): number | null {
  if (candidates.length === 0) {
    return null;
  }

  let matchedSize: number | null = null;
  let matchedKeyLength = -1;

  for (const candidate of candidates) {
    for (const [rawKey, size] of Object.entries(sizes)) {
      const key = normalizeContextLookupKey(rawKey);

      // Allow generic keys such as "gpt-5.4" to match more specific model names
      // like "gpt-5.4-mini-preview", but never let a child key hijack its parent.
      if ((candidate === key || candidate.startsWith(key)) && key.length > matchedKeyLength) {
        matchedSize = size;
        matchedKeyLength = key.length;
      }
    }
  }

  return matchedSize;
}

export function parseContextWindowOverrides(raw: string): Record<string, number> {
  if (!raw || typeof raw !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolve the context window size for a given model string.
 *
 * Resolution order:
 * 1. Explicit model id / known model fragment from the actual model value
 * 2. Provider/model label hints when the visible model value is generic or unknown
 * 3. Built-in generic aliases such as "sonnet" or "opus"
 * 4. Fallback to 200,000
 */
export function getDefaultContextSize(model: string, modelLabel?: string): number {
  const explicitModelCandidates = buildExplicitModelLookupCandidates(model);
  const labelCandidates = buildLabelLookupCandidates(modelLabel);
  const genericAliasCandidates = buildGenericAliasLookupCandidates(model);

  return findBestContextSizeMatch(explicitModelCandidates, DEFAULT_CONTEXT_SIZES)
    ?? findBestContextSizeMatch(labelCandidates, DEFAULT_CONTEXT_SIZES)
    ?? findBestContextSizeMatch(genericAliasCandidates, DEFAULT_CONTEXT_SIZES)
    ?? DEFAULT_CONTEXT_SIZE_FALLBACK;
}

export function resolveContextWindowSize(
  model: string,
  overrides: Record<string, number>,
  modelLabel?: string,
): number {
  const modelCandidates = buildModelLookupCandidates(model);
  const labelCandidates = buildLabelLookupCandidates(modelLabel);

  return findBestContextSizeMatch(modelCandidates, overrides)
    ?? findBestContextSizeMatch(labelCandidates, overrides)
    ?? getDefaultContextSize(model, modelLabel);
}
