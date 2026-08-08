import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const electronAPI = {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  terminal: {
    open: (options: unknown) => ipcRenderer.invoke("terminal:open", options),
    snapshot: (options: unknown) => ipcRenderer.invoke("terminal:snapshot", options),
    write: (options: unknown) => ipcRenderer.invoke("terminal:write", options),
    resize: (options: unknown) => ipcRenderer.invoke("terminal:resize", options),
    close: (options: unknown) => ipcRenderer.invoke("terminal:close", options),
    onData: (cb: (data: { sessionId: string; data: string }) => void) => onEvent("terminal:data", cb),
    onExit: (cb: (data: { sessionId: string; code?: number }) => void) => onEvent("terminal:exit", cb),
    onError: (cb: (data: { sessionId: string; error: string }) => void) => onEvent("terminal:error", cb),
  },

  window: {
    startDragging: () => ipcRenderer.invoke("window:start-dragging"),
  },

  shell: {
    openPath: (targetPath: string) => ipcRenderer.invoke("shell:open-path", targetPath),
    openExternal: (targetUrl: string) => ipcRenderer.invoke("shell:open-external", targetUrl),
  },

  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke("dialog:open-folder", options),
  },

  install: {
    checkPrerequisites: () => ipcRenderer.invoke("install:check-prerequisites"),
    start: (options?: {
      includeNode?: boolean;
      installClaude?: boolean;
      installCodex?: boolean;
      initializeClaude?: boolean;
      initializeCodex?: boolean;
    }) => ipcRenderer.invoke("install:start", options),
    cancel: () => ipcRenderer.invoke("install:cancel"),
    getLogs: () => ipcRenderer.invoke("install:get-logs"),
    onProgress: (cb: (data: unknown) => void) => onEvent("install:progress", cb),
  },

  environment: {
    getShellEnv: () => ipcRenderer.invoke("environment:get-shell-env"),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
