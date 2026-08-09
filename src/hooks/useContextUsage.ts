'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRuntimeStore } from '@/stores/runtime-store';
import { resolveRuntimeContextUsage } from '@/lib/context-usage';
import type { ContextUsageResult } from '@/lib/context-usage';
import { useProviderModelsQuery } from '@/lib/queries/provider-queries';
import { useAppSettingsQuery } from '@/lib/queries/settings-queries';
import { parseContextWindowOverrides, resolveContextWindowSize } from '@/lib/default-context-sizes';
import { SETTING_KEYS } from '@/types';
import type { AssistantRuntime, RuntimeContextState } from '@/types';

/**
 * Hook: compute context usage for a given session and model.
 *
 * Runtime state comes from the native Claude/Codex protocol. Model defaults
 * are a labelled display fallback only. They never create a
 * percentage, trigger compaction, or block a request.
 *
 * Reactivity: polls faster while the stream is active and recomputes for native
 * state, runtime, model, or display-fallback setting changes.
 */
export function useContextUsage(
  sessionId: string,
  model: string,
  providerId: string,
  runtime: AssistantRuntime,
): ContextUsageResult {
  const snapshot = useRuntimeStore((s) => s.snapshots[sessionId]);
  const [nativeState, setNativeState] = useState<RuntimeContextState | null>(null);
  const appSettingsQuery = useAppSettingsQuery();
  const providerModelsQuery = useProviderModelsQuery();
  const rawOverrides = appSettingsQuery.data?.settings?.[SETTING_KEYS.CONTEXT_WINDOW_OVERRIDES] ?? '';
  const effectiveProviderId = providerId || providerModelsQuery.data?.default_provider_id || 'env';
  const modelLabel = useMemo(() => {
    const groups = providerModelsQuery.data?.groups ?? [];
    const group = groups.find((entry) => entry.provider_id === effectiveProviderId);
    return group?.models.find((entry) => entry.value === model)?.label;
  }, [effectiveProviderId, model, providerModelsQuery.data?.groups]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await fetch(`/api/chat/context-state?session_id=${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const payload = await response.json() as { state?: RuntimeContextState | null };
          if (!disposed) setNativeState(payload.state ?? null);
        }
      } catch {
        if (!disposed) setNativeState(null);
      } finally {
        if (!disposed) timer = setTimeout(poll, snapshot?.phase === 'active' ? 750 : 4_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, snapshot?.phase]);

  return useMemo(() => {
    const displayFallbackWindow = resolveContextWindowSize(
      model,
      parseContextWindowOverrides(rawOverrides),
      modelLabel,
    );
    return resolveRuntimeContextUsage(nativeState, runtime, displayFallbackWindow);
  }, [model, modelLabel, nativeState, rawOverrides, runtime]);
}
