import { dialog, ipcMain } from "electron";
import type { FolderDialogOptions, FolderDialogResult } from "../bridge.d";

const DIALOG_MOCK_PATH = (
  process.env.NOONFLOW_DIALOG_MOCK_PATH
  ?? process.env.MONOLITH_DIALOG_MOCK_PATH
  ?? ''
).trim();
const DIALOG_FORCE_CANCEL = (
  process.env.NOONFLOW_DIALOG_MOCK_CANCEL
  ?? process.env.MONOLITH_DIALOG_MOCK_CANCEL
) === "1";

export function registerDialogHandlers() {
  ipcMain.handle("dialog:open-folder", async (_event, options?: FolderDialogOptions): Promise<FolderDialogResult> => {
    if (DIALOG_FORCE_CANCEL) {
      return {
        canceled: true,
        filePaths: [],
      };
    }

    if (DIALOG_MOCK_PATH) {
      return {
        canceled: false,
        filePaths: [DIALOG_MOCK_PATH],
      };
    }

    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: options?.defaultPath,
        title: options?.title,
      });

      return {
        canceled: result.canceled,
        filePaths: result.filePaths,
      };
    } catch {
      return {
        canceled: true,
        filePaths: [],
      };
    }
  });
}
