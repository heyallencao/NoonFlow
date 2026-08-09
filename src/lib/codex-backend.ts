export type CodexBackend = 'legacy-cli' | 'sdk-system-cli';

export const DEFAULT_CODEX_BACKEND: CodexBackend = 'sdk-system-cli';

export function normalizeCodexBackend(value?: string | null): CodexBackend {
  if (value === 'legacy-cli' || value === 'sdk-system-cli') {
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
