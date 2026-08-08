import { ipcMain } from "electron";
import { getShellEnvironment } from "../lib/shell-env";

let handlersRegistered = false;

export function registerEnvironmentHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle("environment:get-shell-env", async () => {
    const env = await getShellEnvironment();
    return env;
  });
}
