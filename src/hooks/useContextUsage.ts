'use client';

import { useMemo } from 'react';
import { useChatTimelineStore } from '@/stores/chat-timeline-store';
import { useRuntimeStore } from '@/stores/runtime-store';
import { calculateContextUsage, type ContextUsageResult } from '@/lib/context-usage';
import { useProviderModelsQuery } from '@/lib/queries/provider-queries';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { SETTING_KEYS } from '@/types';
import type { Message } from '@/types';

const EMPTY_MESSAGES: Message[] = [];

/**
 * Hook: compute context usage for a given session and model.
 *
 * - Accumulates token usage from all persisted messages in the timeline
 * - Adds the current streaming token usage (from stream snapshot) if actively streaming
 * - Resolves context window size from: user overrides → default context sizes → 200K fallback
 *
 * Reactivity: recomputes whenever messages, stream snapshot, or settings change.
 */
export function useContextUsage(
  sessionId: string,
  model: string,
  providerId: string,
): ContextUsageResult {
  const sessionState = useChatTimelineStore((s) => s.sessions[sessionId]);
  const snapshot = useRuntimeStore((s) => s.snapshots[sessionId]);
  const appSettingsQuery = useAppSettingsQuery();
  const providerModelsQuery = useProviderModelsQuery();
  const messages = sessionState?.messages ?? EMPTY_MESSAGES;
  const rawOverrides = appSettingsQuery.data?.settings?.[SETTING_KEYS.CONTEXT_WINDOW_OVERRIDES] ?? '';
  const effectiveProviderId = providerId || providerModelsQuery.data?.default_provider_id || 'env';
  const modelLabel = useMemo(() => {
    const groups = providerModelsQuery.data?.groups ?? [];
    const group = groups.find((entry) => entry.provider_id === effectiveProviderId);
    return group?.models.find((entry) => entry.value === model)?.label;
  }, [effectiveProviderId, model, providerModelsQuery.data?.groups]);

  return useMemo(() => {
    return calculateContextUsage(messages, snapshot, model, rawOverrides, modelLabel);
  }, [messages, model, modelLabel, rawOverrides, snapshot]);
}
