import { ipcMain } from "electron";
import { getServerBaseUrl } from "../server";

const BRIDGE_CHECK_TIMEOUT_MS = 2_000;

export function registerBridgeHandlers() {
  ipcMain.handle("bridge:is-active", async (): Promise<boolean> => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), BRIDGE_CHECK_TIMEOUT_MS);

    try {
      const response = await fetch(`${getServerBaseUrl()}/api/bridge`, {
        signal: abortController.signal,
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { running?: boolean; status?: { running?: boolean } };
      if (typeof body.running === "boolean") return body.running;
      if (typeof body.status?.running === "boolean") return body.status.running;
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  });
}
