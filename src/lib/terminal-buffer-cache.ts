const TERMINAL_BUFFER_MAX_BYTES = 512 * 1024;

type TerminalRuntimeStatus = "connecting" | "connected" | "closed" | "error";

interface TerminalBufferEntry {
  output: string;
  status: TerminalRuntimeStatus;
}

const terminalBufferCache = new Map<string, TerminalBufferEntry>();

function trimToMaxBytes(value: string) {
  if (value.length <= TERMINAL_BUFFER_MAX_BYTES) return value;
  const start = value.length - TERMINAL_BUFFER_MAX_BYTES;
  return value.slice(start);
}

function ensureEntry(sessionId: string): TerminalBufferEntry {
  const existing = terminalBufferCache.get(sessionId);
  if (existing) return existing;
  const created: TerminalBufferEntry = {
    output: "",
    status: "connecting",
  };
  terminalBufferCache.set(sessionId, created);
  return created;
}

export function getTerminalOutputSnapshot(sessionId: string): string {
  return terminalBufferCache.get(sessionId)?.output ?? "";
}

export function replaceTerminalOutputSnapshot(sessionId: string, output: string): void {
  const entry = ensureEntry(sessionId);
  entry.output = trimToMaxBytes(output);
}

export function appendTerminalOutputSnapshot(sessionId: string, outputChunk: string): void {
  if (!outputChunk) return;
  const entry = ensureEntry(sessionId);
  entry.output = trimToMaxBytes(entry.output + outputChunk);
}

export function getTerminalRuntimeStatusSnapshot(sessionId: string): TerminalRuntimeStatus | null {
  return terminalBufferCache.get(sessionId)?.status ?? null;
}

export function setTerminalRuntimeStatusSnapshot(
  sessionId: string,
  status: TerminalRuntimeStatus
): void {
  const entry = ensureEntry(sessionId);
  entry.status = status;
}

export function clearTerminalSessionCache(sessionId: string): void {
  if (!sessionId) return;
  terminalBufferCache.delete(sessionId);
}

