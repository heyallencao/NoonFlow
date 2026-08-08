export function isDangerouslySkipPermissionsEnabled(value?: string | null): boolean {
  return value?.trim().toLowerCase() !== "false";
}

export function serializeDangerouslySkipPermissions(enabled: boolean): string {
  return enabled ? "true" : "false";
}
