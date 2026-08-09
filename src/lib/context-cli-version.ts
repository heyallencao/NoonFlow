export function parseCliVersion(raw: string | null | undefined): [number, number, number] | null {
  const match = raw?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isCliVersionAtLeast(
  raw: string | null | undefined,
  minimum: string,
): boolean {
  const current = parseCliVersion(raw);
  const required = parseCliVersion(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}
