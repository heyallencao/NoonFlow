export interface TerminalOpenOptions {
  sessionId: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
}

export interface TerminalOpenResult {
  reused: boolean;
  snapshot?: string;
}

export interface TerminalWriteOptions {
  sessionId: string;
  data: string;
}

export interface TerminalResizeOptions {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseOptions {
  sessionId: string;
}

export interface TerminalSnapshotOptions {
  sessionId: string;
}

export interface FolderDialogOptions {
  defaultPath?: string;
  title?: string;
}

export interface FolderDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface InstallPrerequisites {
  hasNode: boolean;
  nodeVersion?: string;
  hasGit: boolean;
  gitVersion?: string;
  hasClaude: boolean;
  claudeVersion?: string;
  hasCodex: boolean;
  codexVersion?: string;
  claudeInitialized: boolean;
  codexInitialized: boolean;
  hasHomebrew: boolean;
  platform: string;
}

export interface InstallStartOptions {
  includeNode?: boolean;
  installGit?: boolean;
  installClaude?: boolean;
  installCodex?: boolean;
  initializeClaude?: boolean;
  initializeCodex?: boolean;
}

export type InstallStepStatus = "pending" | "running" | "success" | "failed" | "skipped";
export type InstallStatus = "idle" | "running" | "success" | "failed" | "cancelled";

export interface InstallState {
  status: InstallStatus;
  currentStep: string | null;
  steps: Array<{
    id: string;
    label: string;
    status: InstallStepStatus;
    error?: string;
  }>;
  logs: string[];
}
