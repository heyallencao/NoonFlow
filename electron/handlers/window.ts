import { ipcMain } from "electron";

export function registerWindowHandlers() {
  ipcMain.handle("window:start-dragging", () => {
    // Electron drag region is handled by CSS (-webkit-app-region: drag).
  });
}
