/**
 * Global type declarations for the desktop bridge API.
 */

interface ElectronInstallAPI {
  checkPrerequisites: () => Promise<{
    hasNode: boolean;
    nodeVersion?: string;
    hasClaude: boolean;
    claudeVersion?: string;
    hasCodex: boolean;
    codexVersion?: string;
    claudeInitialized: boolean;
    codexInitialized: boolean;
    hasHomebrew?: boolean;
    platform?: string;
  }>;
  start: (options?: {
    includeNode?: boolean;
    installClaude?: boolean;
    installCodex?: boolean;
    initializeClaude?: boolean;
    initializeCodex?: boolean;
  }) => Promise<void>;
  cancel: () => Promise<void>;
  getLogs: () => Promise<string[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onProgress: (callback: (data: any) => void) => () => void;
}

interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseNotes?: string | { version: string; note: string }[] | null;
    releaseName?: string | null;
    releaseDate?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

interface ElectronUpdaterAPI {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => Promise<void>;
  onStatus: (callback: (data: UpdateStatusEvent) => void) => () => void;
}

interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };
  terminal: {
    open: (options: {
      sessionId: string;
      cwd?: string;
      cols?: number;
      rows?: number;
      shell?: string;
    }) => Promise<{ reused: boolean; snapshot?: string }>;
    snapshot: (options: { sessionId: string }) => Promise<{ snapshot?: string }>;
    write: (options: { sessionId: string; data: string }) => Promise<void>;
    resize: (options: { sessionId: string; cols: number; rows: number }) => Promise<void>;
    close: (options: { sessionId: string }) => Promise<void>;
    onData: (callback: (data: { sessionId: string; data: string }) => void) => () => void;
    onExit: (callback: (data: { sessionId: string; code?: number }) => void) => () => void;
    onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void;
  };
  window: {
    startDragging: () => Promise<void>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
    openExternal: (url: string) => Promise<void>;
  };
  dialog: {
    openFolder: (options?: {
      defaultPath?: string;
      title?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  install: ElectronInstallAPI;
  environment: {
    getShellEnv: () => Promise<Record<string, string>>;
  };
  updater?: ElectronUpdaterAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
