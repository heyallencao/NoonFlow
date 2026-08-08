export type ChatRolloutMode = 'legacy' | 'bridge' | 'canonical';

export const DEFAULT_CHAT_ROLLOUT_MODE: ChatRolloutMode = 'bridge';

export function normalizeChatRolloutMode(value?: string | null): ChatRolloutMode {
  if (value === 'legacy' || value === 'bridge' || value === 'canonical') {
    return value;
  }
  return DEFAULT_CHAT_ROLLOUT_MODE;
}

export function getChatRolloutMode(explicitValue?: string | null): ChatRolloutMode {
  return normalizeChatRolloutMode(
    explicitValue
    ?? process.env.NEXT_PUBLIC_NOONFLOW_CHAT_ROLLOUT_MODE
    ?? process.env.NOONFLOW_CHAT_ROLLOUT_MODE
    ?? process.env.NEXT_PUBLIC_MONOLITH_CHAT_ROLLOUT_MODE
    ?? process.env.MONOLITH_CHAT_ROLLOUT_MODE
    ?? null,
  );
}

export function usesBridgeCompatibilityFallbacks(mode: ChatRolloutMode): boolean {
  return mode !== 'canonical';
}

export function usesLegacyReconciliationFallback(mode: ChatRolloutMode): boolean {
  return mode === 'legacy';
}

export function shouldShowStandaloneStreamingFallback(
  mode: ChatRolloutMode,
  options: {
    isStreaming: boolean;
    hasActiveStreamingAssistantMessage: boolean;
    activeStreamingClientMessageId?: string | null;
  },
): boolean {
  // Standalone streaming bubbles are now reserved for legacy mode only.
  // Bridge/canonical should always converge through timeline-backed messages.
  if (mode !== 'legacy') {
    return false;
  }

  if (!options.isStreaming || options.hasActiveStreamingAssistantMessage) {
    return false;
  }

  // Legacy keeps the standalone bubble only as a fallback for snapshots
  // that still don't map to a timeline assistant record.
  return !options.activeStreamingClientMessageId;
}
