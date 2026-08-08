const GLOBAL_WIDGET_HEIGHT_CACHE_KEY = '__noonflow_widget_height_cache__';
export const WIDGET_HEIGHT_CACHE_MAX_ENTRIES = 200;

type WidgetHeightCache = Map<string, number>;

function getGlobalCache(): WidgetHeightCache {
  const scopedGlobal = globalThis as typeof globalThis & {
    [GLOBAL_WIDGET_HEIGHT_CACHE_KEY]?: WidgetHeightCache;
  };

  if (!scopedGlobal[GLOBAL_WIDGET_HEIGHT_CACHE_KEY]) {
    scopedGlobal[GLOBAL_WIDGET_HEIGHT_CACHE_KEY] = new Map<string, number>();
  }
  return scopedGlobal[GLOBAL_WIDGET_HEIGHT_CACHE_KEY]!;
}

export function getCachedWidgetHeight(key: string): number | null {
  if (!key) {
    return null;
  }
  const cache = getGlobalCache();
  const cached = cache.get(key);
  if (!Number.isFinite(cached)) {
    return null;
  }

  // LRU touch: promote key on read.
  const height = cached as number;
  cache.delete(key);
  cache.set(key, height);
  return height;
}

export function setCachedWidgetHeight(key: string, height: number): void {
  if (!key || !Number.isFinite(height)) {
    return;
  }
  const cache = getGlobalCache();
  cache.delete(key);
  cache.set(key, height);

  while (cache.size > WIDGET_HEIGHT_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

export function clearWidgetHeightCacheForTests(): void {
  getGlobalCache().clear();
}
