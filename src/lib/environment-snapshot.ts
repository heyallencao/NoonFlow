export type SanitizedJsonValue =
  | null
  | boolean
  | number
  | string
  | SanitizedJsonValue[]
  | { [key: string]: SanitizedJsonValue };

function maskSecretValue(value: string): string {
  if (value.length <= 8) return '*'.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function sanitizeEnvironmentJson(value: unknown): SanitizedJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeEnvironmentJson(item));
  if (typeof value === 'object') {
    const result: { [key: string]: SanitizedJsonValue } = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      result[key] = typeof raw === 'string' && /(token|secret|password|api[_-]?key|credential|^key$)/i.test(key)
        ? maskSecretValue(raw)
        : sanitizeEnvironmentJson(raw);
    }
    return result;
  }
  return String(value);
}
