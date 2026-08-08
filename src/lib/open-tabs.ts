export function sanitizeOpenTabIds(tabIds: string[]): string[] {
  return Array.from(new Set(tabIds.filter((tabId) => typeof tabId === 'string' && tabId.length > 0)));
}

export function promoteOpenTabId(tabIds: string[], activeTabId: string): string[] {
  const sanitized = sanitizeOpenTabIds(tabIds);
  if (!activeTabId) {
    return sanitized;
  }

  return [...sanitized.filter((tabId) => tabId !== activeTabId), activeTabId];
}
