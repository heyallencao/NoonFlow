import { registerBridgeHandlers } from "./bridge";
import { registerDialogHandlers } from "./dialog";
import { registerEnvironmentHandlers } from "./environment";
import { registerInstallHandlers } from "./install";
import { registerShellHandlers } from "./shell";
import { cleanupTerminals, registerTerminalHandlers } from "./terminal";
import { registerVersionsHandler } from "./versions";
import { registerWindowHandlers } from "./window";

export function registerAllHandlers() {
  registerTerminalHandlers();
  registerInstallHandlers();
  registerDialogHandlers();
  registerShellHandlers();
  registerWindowHandlers();
  registerBridgeHandlers();
  registerVersionsHandler();
  registerEnvironmentHandlers();
}

export async function cleanupAll() {
  cleanupTerminals();
}
