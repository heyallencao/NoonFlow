function dedupeKeys(primaryKey: string, legacyKeys: readonly string[]): string[] {
  return Array.from(new Set([primaryKey, ...legacyKeys].filter(Boolean)));
}

export function getLocalStorageSafe(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCompatibleStorageValue(
  storage: Storage | null | undefined,
  primaryKey: string,
  legacyKeys: readonly string[] = [],
): string | null {
  if (!storage) {
    return null;
  }

  const keys = dedupeKeys(primaryKey, legacyKeys);
  for (const key of keys) {
    try {
      const value = storage.getItem(key);
      if (value === null) {
        continue;
      }

      if (key !== primaryKey) {
        try {
          storage.setItem(primaryKey, value);
        } catch {
          // Ignore write-back failures and still return the legacy value.
        }
      }
      return value;
    } catch {
      // Keep probing other compatible keys.
    }
  }

  return null;
}

export function writeStorageValue(
  storage: Storage | null | undefined,
  primaryKey: string,
  value: string,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(primaryKey, value);
  } catch {
    // ignore write failures
  }
}

export function removeCompatibleStorageValue(
  storage: Storage | null | undefined,
  primaryKey: string,
  legacyKeys: readonly string[] = [],
): void {
  if (!storage) {
    return;
  }

  const keys = dedupeKeys(primaryKey, legacyKeys);
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore remove failures
    }
  }
}
