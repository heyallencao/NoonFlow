import { ipcMain, shell } from "electron";

function assertSupportedExternalUrl(targetUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
}

export function registerShellHandlers() {
  ipcMain.handle("shell:open-path", async (_event, targetPath: string): Promise<string> => {
    const error = await shell.openPath(targetPath);
    if (error) {
      throw new Error(error);
    }
    return "";
  });

  ipcMain.handle("shell:open-external", async (_event, targetUrl: string): Promise<void> => {
    assertSupportedExternalUrl(targetUrl);
    await shell.openExternal(targetUrl);
  });
}
