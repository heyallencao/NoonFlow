export function pickPreferredWorktreeSessionId({
  candidateSessionIds,
  openTabIds,
  rememberedSessionId,
}: {
  candidateSessionIds: string[];
  openTabIds: string[];
  rememberedSessionId?: string | null;
}): string | null {
  const candidateSet = new Set(candidateSessionIds);

  if (rememberedSessionId && candidateSet.has(rememberedSessionId)) {
    return rememberedSessionId;
  }

  for (let index = openTabIds.length - 1; index >= 0; index -= 1) {
    const sessionId = openTabIds[index];
    if (sessionId && candidateSet.has(sessionId)) {
      return sessionId;
    }
  }

  return null;
}
