/**
 * Unified reference-image store for image generation.
 *
 * Keys:
 *   PENDING_KEY          – images uploaded via the input bar, not yet bound to a message
 *   LAST_GENERATED_KEY   – file paths of the most recently generated images (sessionStorage-backed)
 *   <message-id>         – images bound to a specific assistant message
 */
import type { ReferenceImage } from '@/types';

export const PENDING_KEY = '__pending__';
export const LAST_GENERATED_KEY = '__last_generated__';

const store = new Map<string, ReferenceImage[]>();

// ── sessionStorage persistence for last-generated paths ──

const SS_KEY = 'imgref:last_generated';

function loadLastGenerated(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) {
      const arr: ReferenceImage[] = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        store.set(LAST_GENERATED_KEY, arr);
      }
    }
  } catch {
    // ignore
  }
}

// Auto-restore on module load (client only)
loadLastGenerated();

// ── Public helpers ──

/** Set reference images for a given key. */
export function setRefImages(key: string, images: ReferenceImage[]): void {
  if (images.length === 0) {
    store.delete(key);
  } else {
    store.set(key, images);
  }
}

/** Delete reference images for a given key. */
export function deleteRefImages(key: string): void {
  store.delete(key);
}

/** Get reference images for a given key (or undefined). */
export function getRefImages(key: string): ReferenceImage[] | undefined {
  return store.get(key);
}

/**
 * Transfer pending reference images to a specific message ID.
 * Called when a streaming response transitions to a persisted MessageItem.
 */
export function transferPendingToMessage(messageId: string): void {
  const pending = store.get(PENDING_KEY);
  if (pending) {
    store.set(messageId, pending);
    store.delete(PENDING_KEY);
  }
}

/**
 * Store generated image paths and persist to sessionStorage.
 * Called when image generation completes.
 */
export function setLastGeneratedImages(paths: string[]): void {
  const images: ReferenceImage[] = paths.map(p => ({ mimeType: 'image/png', localPath: p }));
  store.set(LAST_GENERATED_KEY, images);
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(images));
    } catch {
      // storage full
    }
  }
}

/**
 * Single merge entry-point: build a unified ReferenceImage[] for a given context.
 *
 * @param key              Store key (PENDING_KEY or message.id)
 * @param useLastGenerated Whether the LLM requested editing last-generated images
 * @param extraPaths       Additional file paths from the parsed request (referenceImages field)
 */
export function buildReferenceImages(
  key: string,
  useLastGenerated: boolean,
  extraPaths?: string[],
): ReferenceImage[] {
  const result: ReferenceImage[] = [];

  // 1. User-uploaded base64 images
  const uploaded = store.get(key);
  if (uploaded) {
    result.push(...uploaded);
  }

  // 2. Last-generated images (if LLM requested)
  if (useLastGenerated) {
    const lastGen = store.get(LAST_GENERATED_KEY);
    if (lastGen) {
      result.push(...lastGen);
    }
  }

  // 3. Extra paths from the parsed request JSON
  if (extraPaths && extraPaths.length > 0) {
    for (const p of extraPaths) {
      result.push({ mimeType: 'image/png', localPath: p });
    }
  }

  return result;
}
