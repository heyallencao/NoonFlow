export function safeFindings<T>(data: { findings: T[] } | null | undefined): T[] {
  return data?.findings ?? [];
}
