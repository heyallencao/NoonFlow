interface ActiveChatRun {
  abortController: AbortController;
  cleanup: () => void;
}

const GLOBAL_KEY = '__activeChatRuns__' as const;

function getRegistry(): Map<string, ActiveChatRun> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = new Map<string, ActiveChatRun>();
  }
  return globalObject[GLOBAL_KEY] as Map<string, ActiveChatRun>;
}

export function registerActiveChatRun(
  sessionId: string,
  run: ActiveChatRun,
): void {
  const registry = getRegistry();
  const existing = registry.get(sessionId);
  if (existing) {
    try {
      existing.abortController.abort();
    } catch {
      // best effort
    }
    try {
      existing.cleanup();
    } catch {
      // best effort
    }
  }
  registry.set(sessionId, run);
}

export function stopActiveChatRun(sessionId: string): boolean {
  const registry = getRegistry();
  const run = registry.get(sessionId);
  if (!run) {
    return false;
  }

  registry.delete(sessionId);
  try {
    run.abortController.abort();
  } catch {
    // best effort
  }
  try {
    run.cleanup();
  } catch {
    // best effort
  }
  return true;
}

export function unregisterActiveChatRun(
  sessionId: string,
  abortController?: AbortController,
): boolean {
  const registry = getRegistry();
  const run = registry.get(sessionId);
  if (!run) {
    return false;
  }
  if (abortController && run.abortController !== abortController) {
    return false;
  }
  registry.delete(sessionId);
  return true;
}
