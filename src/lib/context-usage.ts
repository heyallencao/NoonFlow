import {
  parseContextWindowOverrides,
  resolveContextWindowSize,
} from '@/lib/default-context-sizes';
import type { Message, SessionStreamSnapshot, TokenUsage } from '@/types';

export interface ContextUsageResult {
  totalTokens: number;
  usedPct: number;
  contextWindowSize: number;
}

export function parseTokenUsage(raw: string | null | undefined): TokenUsage | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as TokenUsage;
  } catch {
    return null;
  }
}

export function getTurnContextUsageTokens(usage: TokenUsage | null): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

export function findLatestAssistantTurnUsage(
  messages: Message[],
  skipClientMessageId?: string | null,
): TokenUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    if (skipClientMessageId && message.client_message_id === skipClientMessageId) {
      continue;
    }

    const usage = parseTokenUsage(message.token_usage);
    if (usage) {
      return usage;
    }
  }

  return null;
}

export function calcContextUsagePct(total: number, contextSize: number): number {
  if (contextSize <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((total / contextSize) * 100)));
}

export function calculateContextUsage(
  messages: Message[],
  snapshot: Pick<SessionStreamSnapshot, 'phase' | 'tokenUsage' | 'clientMessageId'> | null | undefined,
  model: string,
  rawOverrides: string,
  modelLabel?: string,
): ContextUsageResult {
  const snapshotAssistantClientMessageId = snapshot?.clientMessageId ?? null;
  const latestCompletedUsage = findLatestAssistantTurnUsage(messages, snapshotAssistantClientMessageId);
  // Each assistant token_usage payload already reflects the full request for that turn.
  // Use the newest turn only; summing historical turns double-counts prior context.
  const effectiveUsage = snapshot?.tokenUsage ?? latestCompletedUsage;
  const total = getTurnContextUsageTokens(effectiveUsage);

  const overrides = parseContextWindowOverrides(rawOverrides);
  const contextWindowSize = resolveContextWindowSize(model, overrides, modelLabel);
  const usedPct = calcContextUsagePct(total, contextWindowSize);

  return { totalTokens: total, usedPct, contextWindowSize };
}
