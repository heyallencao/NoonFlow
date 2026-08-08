export interface HookScriptSnapshot {
  command: string;
  scriptPath: string | null;
  exists: boolean;
  content: string | null;
  error?: string;
  language: string;
}

export interface HookItem {
  id: string;
  runtime: "claude" | "codex";
  event: string;
  matcher?: string;
  description: string;
  filePath: string;
  commandCount: number;
  commands: string[];
  scripts: HookScriptSnapshot[];
  content: unknown;
}

export interface AgentItem {
  id: string;
  runtime: "claude" | "codex";
  name: string;
  description: string;
  filePath: string;
  format: "markdown" | "yaml";
  sourceName?: string;
  defaultPrompt?: string;
  content: string;
}
