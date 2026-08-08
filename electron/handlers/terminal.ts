import { BrowserWindow, ipcMain } from "electron";
import { statSync } from "node:fs";
import os from "node:os";
import * as pty from "node-pty";
import { buildShellCandidates, getProcessEnvWithShellPath, getShellEnvironment, sanitizeDesktopChildEnv } from "../lib/shell-env";
import type {
  TerminalCloseOptions,
  TerminalOpenOptions,
  TerminalOpenResult,
  TerminalResizeOptions,
  TerminalSnapshotOptions,
  TerminalWriteOptions,
} from "../bridge.d";

const SCROLLBACK_MAX_BYTES = 512 * 1024;

interface TerminalSession {
  pty: pty.IPty;
  scrollback: string;
}

const sessions = new Map<string, TerminalSession>();
let handlersRegistered = false;

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function emitTerminalError(sessionId: string, error: unknown) {
  emitToRenderer("terminal:error", {
    sessionId,
    error: normalizeErrorMessage(error),
  });
}

function resolveDefaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

function shouldRetryShellSpawn(error: unknown) {
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes("posix_spawnp failed")
    || message.includes("enoent")
    || message.includes("not found")
    || message.includes("no such file")
  );
}

function resolveShellArgs() {
  // -i: interactive shell, loads ~/.zshrc or ~/.bashrc
  // -l: login shell, loads ~/.zprofile or ~/.bash_profile
  // Combined: get full user environment including PATH customizations
  return process.platform === "win32" ? [] : ["-il"];
}

function resolveUtf8Locale(): string {
  for (const key of ["LC_ALL", "LC_CTYPE", "LANG"] as const) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    const normalized = value.toLowerCase();
    if (normalized.includes("utf-8") || normalized.includes("utf8")) {
      return value;
    }
  }
  return process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
}

const SHELL_PREFERRED_ENV_KEYS = [
  "NODE_ENV",
  "NPM_CONFIG_OMIT",
  "npm_config_omit",
  "NPM_CONFIG_PRODUCTION",
  "npm_config_production",
] as const;

function applyShellEnvOverrides(
  targetEnv: Record<string, string>,
  shellEnv: Record<string, string>,
): Record<string, string> {
  const merged = { ...targetEnv };
  for (const key of SHELL_PREFERRED_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(shellEnv, key)) {
      merged[key] = shellEnv[key];
    } else {
      delete merged[key];
    }
  }
  return merged;
}

function emitToRenderer(channel: string, payload: unknown) {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function appendScrollback(session: TerminalSession, data: string) {
  session.scrollback += data;
  if (session.scrollback.length > SCROLLBACK_MAX_BYTES) {
    session.scrollback = session.scrollback.slice(session.scrollback.length - SCROLLBACK_MAX_BYTES);
  }
}

function resolveWorkingDirectory(cwd?: string) {
  const candidate = cwd?.trim();
  if (!candidate) return process.env.HOME || os.homedir();
  try {
    if (statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    // Ignore and fallback.
  }
  return process.env.HOME || os.homedir();
}

function closeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.pty.kill();
  } catch {
    // Ignore exit races.
  }
  emitToRenderer("terminal:exit", { sessionId, code: undefined });
}

export function registerTerminalHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle("terminal:open", async (_event, options: TerminalOpenOptions): Promise<TerminalOpenResult> => {
    const sessionId = options?.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");

    const existing = sessions.get(sessionId);
    if (existing) {
      const cols = Math.max(options.cols ?? 120, 20);
      const rows = Math.max(options.rows ?? 36, 10);
      try {
        existing.pty.resize(cols, rows);
      } catch (error) {
        emitTerminalError(sessionId, error);
      }
      return { reused: true, snapshot: existing.scrollback || undefined };
    }

    const cols = Math.max(options.cols ?? 120, 20);
    const rows = Math.max(options.rows ?? 36, 10);
    const cwd = resolveWorkingDirectory(options.cwd);
    const locale = resolveUtf8Locale();
    const shellEnv = await getShellEnvironment();
    const processEnvWithShellPath = await getProcessEnvWithShellPath(process.env);
    const terminalEnv = sanitizeDesktopChildEnv({
      ...applyShellEnvOverrides(processEnvWithShellPath, shellEnv),
      TERM: "xterm-256color",
      LC_ALL: locale,
      LANG: locale,
      LC_CTYPE: locale,
    });

    const shellCandidates = buildShellCandidates(terminalEnv, options.shell?.trim() || resolveDefaultShell());
    let ptyProcess: pty.IPty | null = null;
    let lastSpawnError: unknown = null;

    for (const shell of shellCandidates) {
      try {
        ptyProcess = pty.spawn(shell, resolveShellArgs(), {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env: terminalEnv,
        });
        break;
      } catch (error) {
        lastSpawnError = error;
        if (!shouldRetryShellSpawn(error)) {
          emitTerminalError(sessionId, error);
          throw error;
        }
      }
    }

    if (!ptyProcess) {
      const attempted = shellCandidates.length > 0 ? shellCandidates.join(", ") : "(none)";
      const terminalError = new Error(
        `Failed to launch terminal shell. Tried: ${attempted}. Last error: ${normalizeErrorMessage(lastSpawnError)}`,
      );
      emitTerminalError(sessionId, terminalError);
      throw terminalError;
    }

    const session: TerminalSession = { pty: ptyProcess, scrollback: "" };
    sessions.set(sessionId, session);

    ptyProcess.onData((data) => {
      appendScrollback(session, data);
      emitToRenderer("terminal:data", { sessionId, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (sessions.delete(sessionId)) {
        if (typeof exitCode === "number" && exitCode !== 0) {
          emitTerminalError(sessionId, `terminal exited with code ${exitCode}`);
        }
        emitToRenderer("terminal:exit", { sessionId, code: exitCode });
      }
    });

    const eventEmitterPty = ptyProcess as unknown as { on?: (event: string, cb: (err: Error) => void) => void };
    eventEmitterPty.on?.("error", (error) => {
      emitTerminalError(sessionId, error);
    });

    return { reused: false };
  });

  ipcMain.handle("terminal:write", (_event, options: TerminalWriteOptions): void => {
    const sessionId = options?.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");
    const session = sessions.get(sessionId);
    if (!session) {
      // A closed/stale session can race with frontend teardown writes; ignore safely.
      return;
    }
    try {
      session.pty.write(options.data);
    } catch (error) {
      emitTerminalError(sessionId, error);
      throw error;
    }
  });

  ipcMain.handle("terminal:resize", (_event, options: TerminalResizeOptions): void => {
    const sessionId = options?.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");
    const session = sessions.get(sessionId);
    if (!session) {
      // A closed/stale session can race with frontend teardown resizes; ignore safely.
      return;
    }
    try {
      session.pty.resize(Math.max(options.cols, 20), Math.max(options.rows, 10));
    } catch (error) {
      emitTerminalError(sessionId, error);
      throw error;
    }
  });

  ipcMain.handle("terminal:close", (_event, options: TerminalCloseOptions): void => {
    const sessionId = options?.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");
    try {
      closeSession(sessionId);
    } catch (error) {
      emitTerminalError(sessionId, error);
      throw error;
    }
  });

  ipcMain.handle("terminal:snapshot", (_event, options: TerminalSnapshotOptions): { snapshot?: string } => {
    const sessionId = options?.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");
    try {
      const session = sessions.get(sessionId);
      if (!session || !session.scrollback) return {};
      return { snapshot: session.scrollback };
    } catch (error) {
      emitTerminalError(sessionId, error);
      throw error;
    }
  });
}

export function cleanupTerminals() {
  for (const sessionId of Array.from(sessions.keys())) {
    closeSession(sessionId);
  }
}
