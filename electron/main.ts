import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { cleanupAll, registerAllHandlers } from "./handlers";
import { getShellEnvironment } from "./lib/shell-env";
import {
  getAppProtocolEntry,
  handleAppProtocol,
  isServerReady,
  registerAppProtocol,
  startServer,
  stopServer,
} from "./server";

const isDevelopment = process.env.NODE_ENV === "development";

if (!isDevelopment) {
  registerAppProtocol();
}

let mainWindow: BrowserWindow | null = null;
const APP_WINDOW_TITLE = "NoonFlow";
const PROTECTED_ENV_KEYS = new Set(["NODE_ENV", "ELECTRON_RUN_AS_NODE"]);
const STARTUP_ERROR_TITLE = `${APP_WINDOW_TITLE} failed to start`;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function showStartupError(error: unknown): void {
  const details = formatErrorMessage(error);
  console.error("[electron] startup error", details);

  try {
    dialog.showErrorBox(
      STARTUP_ERROR_TITLE,
      [
        "The desktop app exited during startup.",
        "",
        details,
      ].join("\n"),
    );
  } catch (dialogError) {
    console.error("[electron] failed to show startup dialog", dialogError);
  }
}

function getInternalOrigins(): Set<string> {
  const origins = new Set<string>();
  if (isDevelopment) {
    const devServerUrl = process.env.NEXT_DEV_SERVER_URL || "http://127.0.0.1:3000";
    try {
      origins.add(new URL(devServerUrl).origin);
    } catch {
      // ignore invalid dev server url
    }
  }
  return origins;
}

function isInternalNavigationTarget(targetUrl: string): boolean {
  if (targetUrl.startsWith("app://")) {
    return true;
  }
  if (targetUrl === "about:blank") {
    return true;
  }

  try {
    const parsed = new URL(targetUrl);
    return getInternalOrigins().has(parsed.origin);
  } catch {
    return false;
  }
}

function openExternalUrl(targetUrl: string): void {
  try {
    const parsed = new URL(targetUrl);
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return;
    }
    void shell.openExternal(targetUrl);
  } catch {
    // ignore invalid urls
  }
}

function applyContentSecurityPolicy(window: BrowserWindow) {
  const policy = isDevelopment
    ? "default-src 'self' app: 'unsafe-inline' 'unsafe-eval'; connect-src 'self' app: http://127.0.0.1:* https:; img-src 'self' app: data: blob: https: file:; media-src 'self' app: blob:; style-src 'self' 'unsafe-inline' app:;"
    : "default-src 'self' app:; script-src 'self' app: 'unsafe-inline'; connect-src 'self' app: http://127.0.0.1:* https:; img-src 'self' app: data: blob: https: file:; media-src 'self' app: blob:; style-src 'self' 'unsafe-inline' app:; font-src 'self' app: data:;";

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
      },
    });
  });
}

async function loadWindowContent(window: BrowserWindow) {
  if (isDevelopment) {
    const devServerUrl = process.env.NEXT_DEV_SERVER_URL || "http://127.0.0.1:3000";
    await window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  const url = getAppProtocolEntry();
  console.log("[NoonFlow] Loading URL:", url);
  await window.loadURL(url);
  console.log("[NoonFlow] Page loaded");
}

async function createWindow() {
  // 图标路径：开发环境从 electron/icons 读取，生产环境从 extraResources 读取
  const iconPath = isDevelopment
    ? path.join(__dirname, "./icons/icon.png")
    : path.join(process.resourcesPath, "electron/icons/icon.png");

  console.log("[NoonFlow] Icon path:", iconPath);
  console.log("[NoonFlow] Icon exists:", fs.existsSync(iconPath));

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: APP_WINDOW_TITLE,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d0d0d",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setTitle(APP_WINDOW_TITLE);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_WINDOW_TITLE);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalNavigationTarget(url)) {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigationTarget(url)) {
      return;
    }
    event.preventDefault();
    openExternalUrl(url);
  });

  applyContentSecurityPolicy(window);

  // Keep desktop window title stable instead of inheriting arbitrary page titles.
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    if (window.getTitle() !== APP_WINDOW_TITLE) {
      window.setTitle(APP_WINDOW_TITLE);
    }
  });

  await loadWindowContent(window);
  window.setTitle(APP_WINDOW_TITLE);

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

async function hydrateProcessEnvironmentFromShell() {
  if (process.platform === "win32") {
    return;
  }

  try {
    const shellEnv = await getShellEnvironment();
    for (const [key, value] of Object.entries(shellEnv)) {
      if (PROTECTED_ENV_KEYS.has(key)) {
        continue;
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn("[electron] Failed to hydrate process env from shell", error);
  }
}

async function bootstrap() {
  await hydrateProcessEnvironmentFromShell();
  app.setName(APP_WINDOW_TITLE);
  process.title = APP_WINDOW_TITLE;

  if (!isDevelopment) {
    await startServer();
    handleAppProtocol();
    // Re-assert app name after Next.js server.js load, which may reset process title.
    app.setName(APP_WINDOW_TITLE);
    process.title = APP_WINDOW_TITLE;
  }

  registerAllHandlers();
  await createWindow();
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    showStartupError(error);
    app.exit(1);
  }
});

process.on("uncaughtException", (error) => {
  showStartupError(error);
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  showStartupError(reason);
  app.exit(1);
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      await createWindow();
    } catch (error) {
      console.error("[electron] failed to recreate window", error);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  try {
    await cleanupAll();
    if (isServerReady()) {
      await stopServer();
    }
  } catch (error) {
    console.error("[electron] cleanup failed", error);
  }
});
