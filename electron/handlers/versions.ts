import { ipcMain } from "electron";

export function registerVersionsHandler() {
  ipcMain.handle("get-versions", () => ({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }));
}
