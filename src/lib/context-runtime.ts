import type {
  AssistantRuntime,
  RuntimeCompactionState,
  RuntimeContextState,
  RuntimeContextTokenState,
  TokenUsage,
} from '@/types';

const runtimeContextStatesKey = '__noonflowRuntimeContextStates__';

function runtimeContextStates(): Map<string, RuntimeContextState> {
  const shared = globalThis as Record<string, unknown>;
  if (!(shared[runtimeContextStatesKey] instanceof Map)) {
    shared[runtimeContextStatesKey] = new Map<string, RuntimeContextState>();
  }
  return shared[runtimeContextStatesKey] as Map<string, RuntimeContextState>;
}

export function createUnavailableRuntimeContextState(
  runtime: AssistantRuntime,
): RuntimeContextState {
  return {
    runtime,
    currentContext: null,
    lastTurnUsage: null,
    source: 'unavailable',
    compaction: { status: 'idle' },
    updatedAt: Date.now(),
  };
}

export function getRuntimeContextState(sessionId: string): RuntimeContextState | null {
  return runtimeContextStates().get(sessionId) ?? null;
}

export function setRuntimeContextState(
  sessionId: string,
  state: RuntimeContextState,
): RuntimeContextState {
  const next = structuredClone({ ...state, updatedAt: Date.now() });
  runtimeContextStates().set(sessionId, next);
  return next;
}

export function updateRuntimeContextState(
  sessionId: string,
  runtime: AssistantRuntime,
  patch: Partial<Pick<RuntimeContextState, 'currentContext' | 'lastTurnUsage' | 'source'>> & {
    compaction?: RuntimeCompactionState;
  },
): RuntimeContextState {
  const previous = getRuntimeContextState(sessionId) ?? createUnavailableRuntimeContextState(runtime);
  return setRuntimeContextState(sessionId, {
    ...previous,
    ...patch,
    runtime,
    compaction: patch.compaction ?? previous.compaction,
  });
}

export function buildNativeTokenState(
  usedTokens: number,
  contextWindowTokens: number | null,
): RuntimeContextTokenState {
  const normalizedUsed = Number.isFinite(usedTokens) ? Math.max(0, Math.round(usedTokens)) : 0;
  const normalizedWindow = contextWindowTokens !== null
    && Number.isFinite(contextWindowTokens)
    && contextWindowTokens > 0
    ? Math.round(contextWindowTokens)
    : null;
  return {
    usedTokens: normalizedUsed,
    contextWindowTokens: normalizedWindow,
    percentage: normalizedWindow === null
      ? null
      : Math.min(100, Math.max(0, Math.round((normalizedUsed / normalizedWindow) * 100))),
  };
}

export function buildNativeRuntimeContextState(params: {
  runtime: AssistantRuntime;
  usedTokens: number;
  contextWindowTokens: number | null;
  lastTurnUsage?: TokenUsage | null;
  compaction?: RuntimeCompactionState;
}): RuntimeContextState {
  return {
    runtime: params.runtime,
    currentContext: buildNativeTokenState(params.usedTokens, params.contextWindowTokens),
    lastTurnUsage: params.lastTurnUsage ?? null,
    source: 'native',
    compaction: params.compaction ?? { status: 'idle' },
    updatedAt: Date.now(),
  };
}

export function clearRuntimeContextState(sessionId: string): void {
  runtimeContextStates().delete(sessionId);
}
