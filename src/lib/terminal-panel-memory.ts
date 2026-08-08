export interface TerminalPanelMemoryState {
  isOpen: boolean;
  height: number;
  sessionId: string | null;
}

const TERMINAL_PANEL_MEMORY_KEY = '__noonflowTerminalPanelMemory__' as const;

function getTerminalPanelMemory(): Map<string, TerminalPanelMemoryState> {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[TERMINAL_PANEL_MEMORY_KEY]) {
    globalObject[TERMINAL_PANEL_MEMORY_KEY] = new Map<string, TerminalPanelMemoryState>();
  }
  return globalObject[TERMINAL_PANEL_MEMORY_KEY] as Map<string, TerminalPanelMemoryState>;
}

export function readTerminalPanelMemory(workspace: string): TerminalPanelMemoryState | null {
  return getTerminalPanelMemory().get(workspace) ?? null;
}

export function writeTerminalPanelMemory(workspace: string, state: TerminalPanelMemoryState): void {
  if (!workspace) return;
  getTerminalPanelMemory().set(workspace, state);
}

export function clearTerminalPanelMemory(workspace: string): string | null {
  const memory = getTerminalPanelMemory();
  const sessionId = memory.get(workspace)?.sessionId ?? null;
  memory.delete(workspace);
  return sessionId;
}
