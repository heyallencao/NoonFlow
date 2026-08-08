import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  createdAt: number;
  abortSignal?: AbortSignal;
  toolInput: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Use globalThis to ensure the Map is shared across all module instances.
// In Next.js dev mode (Turbopack), different API routes may load separate
// module instances, so a module-level variable would NOT be shared.
const globalKey = '__pendingPermissions__' as const;

function getMap(): Map<string, PendingPermission> {
  if (!(globalThis as Record<string, unknown>)[globalKey]) {
    (globalThis as Record<string, unknown>)[globalKey] = new Map<string, PendingPermission>();
  }
  return (globalThis as Record<string, unknown>)[globalKey] as Map<string, PendingPermission>;
}

/**
 * Helper to deny and remove a pending permission entry.
 */
function denyAndRemove(id: string, message: string) {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.resolve({ behavior: 'deny', message });
  map.delete(id);
}

/**
 * Register a pending permission request.
 * Returns a Promise that resolves when the user responds or after TIMEOUT_MS.
 */
export function registerPendingPermission(
  id: string,
  toolInput: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<PermissionResult> {
  const map = getMap();

  return new Promise<PermissionResult>((resolve) => {
    // Per-request independent timer: auto-deny after TIMEOUT_MS
    const timer = setTimeout(() => {
      if (map.has(id)) {
        console.warn(`[permission-registry] Permission request ${id} timed out after ${TIMEOUT_MS / 1000}s`);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
        map.delete(id);
      }
    }, TIMEOUT_MS);

    map.set(id, {
      resolve,
      createdAt: Date.now(),
      abortSignal,
      toolInput,
      timer,
    });

    // Auto-deny if the abort signal fires (client disconnect / stop button)
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => denyAndRemove(id, 'Request aborted'), { once: true });
    }
  });
}

/**
 * Resolve a pending permission request with the user's decision.
 * Returns true if the permission was found and resolved, false otherwise.
 */
export function hasPendingPermission(id: string): boolean {
  return getMap().has(id);
}

export function resolvePendingPermission(
  id: string,
  result: PermissionResult,
): boolean {
  const map = getMap();
  const entry = map.get(id);
  if (!entry) return false;

  clearTimeout(entry.timer);

  if (result.behavior === 'allow' && !result.updatedInput) {
    result = { ...result, updatedInput: entry.toolInput };
  }

  entry.resolve(result);
  map.delete(id);
  return true;
}
