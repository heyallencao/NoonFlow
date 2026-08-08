export type CodexBackend = 'legacy-cli' | 'sdk-system-cli' | 'sdk-bundled';

export const DEFAULT_CODEX_BACKEND: CodexBackend = 'sdk-system-cli';
const CODEX_BUNDLED_ENABLE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function normalizeCodexBackend(value?: string | null): CodexBackend {
  if (value === 'legacy-cli' || value === 'sdk-system-cli' || value === 'sdk-bundled') {
    return value;
  }
  return DEFAULT_CODEX_BACKEND;
}

export function getCodexBackend(explicitValue?: string | null): CodexBackend {
  return normalizeCodexBackend(
    explicitValue
    ?? process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND
    ?? process.env.NOONFLOW_CODEX_BACKEND
    ?? process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND
    ?? process.env.MONOLITH_CODEX_BACKEND
    ?? null,
  );
}

export function isCodexBundledBackendEnabled(explicitValue?: string | null): boolean {
  const normalized = (
    explicitValue
    ?? process.env.NEXT_PUBLIC_NOONFLOW_ENABLE_CODEX_BUNDLED
    ?? process.env.NOONFLOW_ENABLE_CODEX_BUNDLED
    ?? process.env.NEXT_PUBLIC_MONOLITH_ENABLE_CODEX_BUNDLED
    ?? process.env.MONOLITH_ENABLE_CODEX_BUNDLED
    ?? ''
  ).trim().toLowerCase();

  return CODEX_BUNDLED_ENABLE_VALUES.has(normalized);
}

export function getCodexBackendSupportError(backend?: CodexBackend): string | null {
  if (backend === 'sdk-bundled' && !isCodexBundledBackendEnabled()) {
    return 'Codex backend "sdk-bundled" is gated until packaged-app validation completes. Enable it explicitly with NOONFLOW_ENABLE_CODEX_BUNDLED=true after verifying bundled builds.';
  }
  return null;
}
