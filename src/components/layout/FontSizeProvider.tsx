'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const APP_FONT_SCALE_STORAGE_KEY = 'noonflow:ui-font-scale';
const LEGACY_APP_FONT_SCALE_STORAGE_KEYS = ['monolith:ui-font-scale'] as const;

const LEGACY_DEFAULT_FONT_SCALE = 1.0625;
const DEFAULT_FONT_SCALE = 1;
const MIN_FONT_SCALE = 0.9;
const MAX_FONT_SCALE = 1.25;
const FONT_SCALE_STEP = 0.05;

function normalizeFontScale(value: number): number {
  const bounded = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
  return Number(bounded.toFixed(4));
}

function parseFontScale(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return normalizeFontScale(parsed);
}

function coerceStoredFontScale(raw: unknown): number | null {
  const parsed = parseFontScale(raw);
  if (parsed === null) {
    return null;
  }

  return Math.abs(parsed - LEGACY_DEFAULT_FONT_SCALE) < 0.0001
    ? DEFAULT_FONT_SCALE
    : parsed;
}

interface FontSizeContextValue {
  fontScale: number;
  fontScalePercent: number;
  minFontScale: number;
  maxFontScale: number;
  defaultFontScale: number;
  fontScaleStep: number;
  setFontScale: (value: number) => void;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
  resetFontScale: () => void;
}

const FontSizeContext = createContext<FontSizeContextValue>({
  fontScale: DEFAULT_FONT_SCALE,
  fontScalePercent: Math.round(DEFAULT_FONT_SCALE * 100),
  minFontScale: MIN_FONT_SCALE,
  maxFontScale: MAX_FONT_SCALE,
  defaultFontScale: DEFAULT_FONT_SCALE,
  fontScaleStep: FONT_SCALE_STEP,
  setFontScale: () => {},
  increaseFontScale: () => {},
  decreaseFontScale: () => {},
  resetFontScale: () => {},
});

export function useFontSize() {
  return useContext(FontSizeContext);
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_FONT_SCALE;
    }
    return coerceStoredFontScale(
      readCompatibleStorageValue(
        getLocalStorageSafe(),
        APP_FONT_SCALE_STORAGE_KEY,
        LEGACY_APP_FONT_SCALE_STORAGE_KEYS,
      ),
    ) ?? DEFAULT_FONT_SCALE;
  });
  const [hasStoredFontScale] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return coerceStoredFontScale(
      readCompatibleStorageValue(
        getLocalStorageSafe(),
        APP_FONT_SCALE_STORAGE_KEY,
        LEGACY_APP_FONT_SCALE_STORAGE_KEYS,
      ),
    ) !== null;
  });

  useEffect(() => {
    if (hasStoredFontScale) {
      return;
    }

    const controller = new AbortController();
    void fetch('/api/settings/app', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const savedFromDb = coerceStoredFontScale(data?.settings?.ui_font_scale);
        if (savedFromDb !== null) {
          setFontScaleState(savedFromDb);
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [hasStoredFontScale]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const normalized = normalizeFontScale(fontScale);
    document.documentElement.style.setProperty('--app-font-scale', String(normalized));

    try {
      writeStorageValue(getLocalStorageSafe(), APP_FONT_SCALE_STORAGE_KEY, String(normalized));
    } catch {
      // ignore localStorage errors
    }
  }, [fontScale]);

  const persistFontScale = useCallback((nextScale: number) => {
    void fetch('/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          ui_font_scale: String(nextScale),
        },
      }),
    }).catch(() => {});
  }, []);

  const setFontScale = useCallback(
    (value: number) => {
      const normalized = normalizeFontScale(value);
      setFontScaleState(normalized);
      persistFontScale(normalized);
    },
    [persistFontScale],
  );

  const increaseFontScale = useCallback(() => {
    setFontScaleState((prev) => {
      const normalized = normalizeFontScale(prev + FONT_SCALE_STEP);
      persistFontScale(normalized);
      return normalized;
    });
  }, [persistFontScale]);

  const decreaseFontScale = useCallback(() => {
    setFontScaleState((prev) => {
      const normalized = normalizeFontScale(prev - FONT_SCALE_STEP);
      persistFontScale(normalized);
      return normalized;
    });
  }, [persistFontScale]);

  const resetFontScale = useCallback(() => {
    setFontScale(DEFAULT_FONT_SCALE);
  }, [setFontScale]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const commandLike = event.metaKey || event.ctrlKey;
      if (!commandLike || event.altKey) {
        return;
      }

      const isIncrease =
        event.key === '+' ||
        event.key === '=' ||
        event.code === 'NumpadAdd';
      if (isIncrease) {
        event.preventDefault();
        increaseFontScale();
        return;
      }

      const isDecrease =
        event.key === '-' ||
        event.key === '_' ||
        event.code === 'NumpadSubtract';
      if (isDecrease) {
        event.preventDefault();
        decreaseFontScale();
        return;
      }

      if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') {
        event.preventDefault();
        resetFontScale();
      }
    };

    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
    };
  }, [decreaseFontScale, increaseFontScale, resetFontScale]);

  const value = useMemo<FontSizeContextValue>(
    () => ({
      fontScale,
      fontScalePercent: Math.round(fontScale * 100),
      minFontScale: MIN_FONT_SCALE,
      maxFontScale: MAX_FONT_SCALE,
      defaultFontScale: DEFAULT_FONT_SCALE,
      fontScaleStep: FONT_SCALE_STEP,
      setFontScale,
      increaseFontScale,
      decreaseFontScale,
      resetFontScale,
    }),
    [fontScale, setFontScale, increaseFontScale, decreaseFontScale, resetFontScale],
  );

  return (
    <FontSizeContext.Provider value={value}>
      {children}
    </FontSizeContext.Provider>
  );
}
