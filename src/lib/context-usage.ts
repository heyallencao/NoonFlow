import {
  parseContextWindowOverrides,
  resolveContextWindowSize,
} from '@/lib/default-context-sizes';
import type {
  AssistantRuntime,
  Message,
  RuntimeCompactionState,
  RuntimeContextSource,
  RuntimeContextState,
  SessionStreamSnapshot,
  TokenUsage,
} from '@/types';

export interface ContextUsageResult {
  totalTokens: number | null;
  usedPct: number | null;
  contextWindowSize: number | null;
  lastTurnUsage: TokenUsage | null;
  source: RuntimeContextSource;
  compaction: RuntimeCompactionState;
}

export interface CompactionDisplay {
  status: Exclude<RuntimeCompactionState['status'], 'idle'>;
  label: string;
  detail: string;
}

export function buildCompactionDisplay(
  compaction: RuntimeCompactionState,
): CompactionDisplay | null {
  if (compaction.status === 'idle') return null;

  const trigger = compaction.trigger === 'recovery'
    ? '窗口溢出恢复'
    : compaction.trigger === 'manual'
      ? '手动触发'
      : compaction.trigger === 'auto'
        ? '自动触发'
        : '原生事件';
  const tokenTransition = typeof compaction.preTokens === 'number'
    && typeof compaction.postTokens === 'number'
    ? `${compaction.preTokens.toLocaleString()} → ${compaction.postTokensEstimated ? '约 ' : ''}${compaction.postTokens.toLocaleString()} tokens`
    : null;
  const startedAt = typeof compaction.startedAt === 'number'
    ? `开始 ${new Date(compaction.startedAt).toISOString()}`
    : null;
  const completedAt = typeof compaction.completedAt === 'number'
    ? `结束 ${new Date(compaction.completedAt).toISOString()}`
    : null;
  const details = [trigger, tokenTransition, startedAt, completedAt, compaction.error]
    .filter((value): value is string => Boolean(value));

  if (compaction.status === 'compacting') {
    return { status: 'compacting', label: '压缩中', detail: details.join(' · ') };
  }
  if (compaction.status === 'completed') {
    return {
      status: 'completed',
      label: tokenTransition ? `压缩完成 ${tokenTransition}` : '压缩完成',
      detail: details.join(' · '),
    };
  }
  return {
    status: 'failed',
    label: compaction.error ? `压缩失败：${compaction.error}` : '压缩失败',
    detail: details.join(' · '),
  };
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

  return {
    totalTokens: total,
    usedPct,
    contextWindowSize,
    lastTurnUsage: effectiveUsage,
    source: 'estimated',
    compaction: { status: 'idle' },
  };
}

export function resolveRuntimeContextUsage(
  state: RuntimeContextState | null,
  runtime: AssistantRuntime,
  displayFallbackWindow: number,
): ContextUsageResult {
  if (state?.runtime === runtime && state.source === 'native' && state.currentContext) {
    return {
      totalTokens: state.currentContext.usedTokens,
      usedPct: state.currentContext.percentage,
      contextWindowSize: state.currentContext.contextWindowTokens ?? displayFallbackWindow,
      lastTurnUsage: state.lastTurnUsage,
      source: 'native',
      compaction: state.compaction,
    };
  }

  return {
    totalTokens: null,
    usedPct: null,
    contextWindowSize: displayFallbackWindow,
    lastTurnUsage: state?.runtime === runtime ? state.lastTurnUsage : null,
    source: 'unavailable',
    compaction: state?.runtime === runtime
      ? state.compaction
      : { status: 'idle' },
  };
}
