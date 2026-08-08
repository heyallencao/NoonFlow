import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type StringEnv = Record<string, string>;

const CACHE_TTL_MS = 60_000;
const FALLBACK_CACHE_TTL_MS = 10_000;
const TIMEOUT_FALLBACK_CACHE_TTL_MS = 60_000;
const SHELL_ENV_TIMEOUT_MS = 8_000;
const MAX_ENV_OUTPUT_BYTES = 4 * 1024 * 1024;
const APP_ONLY_ENV_PREFIXES = [
  "NOONFLOW_",
  "NEXT_PUBLIC_NOONFLOW_",
  "MONOLITH_",
  "NEXT_PUBLIC_MONOLITH_",
] as const;
const APP_ONLY_ENV_KEYS = [
  "NODE_ENV",
  "NEXT_DEV_SERVER_URL",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ELECTRON_NO_ASAR",
  "npm_config_runtime",
  "npm_config_target",
  "npm_config_disturl",
  "npm_config_devdir",
  "npm_config_arch",
  "NPM_CONFIG_RUNTIME",
  "NPM_CONFIG_TARGET",
  "NPM_CONFIG_DISTURL",
  "NPM_CONFIG_DEVDIR",
  "NPM_CONFIG_ARCH",
] as const;

let cachedEnv: Record<string, string> | null = null;
let cacheTime = 0;
let isFallbackCache = false;
let fallbackCacheTtlMs = FALLBACK_CACHE_TTL_MS;
let inFlightProbe: Promise<Record<string, string>> | null = null;

class ShellEnvTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`[shell-env] Timed out after ${timeoutMs}ms`);
  }
}

function copyStringEnv(baseEnv: NodeJS.ProcessEnv | StringEnv = process.env): StringEnv {
  const env: StringEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

function resolveDefaultShell(baseEnv: NodeJS.ProcessEnv | StringEnv = process.env): string {
  if (process.platform === "win32") {
    return baseEnv.COMSPEC || process.env.COMSPEC || "cmd.exe";
  }
  return baseEnv.SHELL || process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
}

function isExecutableShellPath(candidate: string) {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function buildShellCandidates(
  baseEnv: NodeJS.ProcessEnv | StringEnv = process.env,
  preferredShell?: string,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate?: string) => {
    const normalized = candidate?.trim();
    if (!normalized || candidates.includes(normalized)) {
      return;
    }
    if (process.platform !== "win32" && normalized.startsWith("/") && !isExecutableShellPath(normalized)) {
      return;
    }
    candidates.push(normalized);
  };

  if (process.platform === "win32") {
    pushCandidate(preferredShell);
    pushCandidate(baseEnv.COMSPEC);
    pushCandidate(process.env.COMSPEC);
    pushCandidate("powershell.exe");
    pushCandidate("cmd.exe");
    return candidates;
  }

  pushCandidate(preferredShell);
  pushCandidate(baseEnv.SHELL);
  pushCandidate(process.env.SHELL);
  pushCandidate(resolveDefaultShell(baseEnv));
  pushCandidate("/bin/zsh");
  pushCandidate("/bin/bash");
  pushCandidate("/bin/sh");

  return candidates;
}

function getNvmNodeBinDirs(home: string): string[] {
  if (process.platform === "win32") return [];

  const nvmNodeVersionsDir = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(nvmNodeVersionsDir)
      .map((versionDir) => path.join(nvmNodeVersionsDir, versionDir, "bin"))
      .filter((binDir) => {
        try {
          return statSync(binDir).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function getFallbackPathEnv(): string {
  const entries: string[] = [];
  if (process.env.PATH) entries.push(process.env.PATH);

  if (process.platform === "darwin") {
    entries.push(
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/homebrew/opt/node/bin",
      "/usr/local/opt/node/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    );
  }

  const home = process.env.HOME || os.homedir();
  if (home) {
    entries.push(
      path.join(home, ".superset", "bin"),
      path.join(home, ".local", "bin"),
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".claude", "bin"),
      path.join(home, ".codex", "bin"),
      ...getNvmNodeBinDirs(home),
    );
  }

  const seen = new Set<string>();
  return entries.filter((entry) => entry && !seen.has(entry) && seen.add(entry)).join(path.delimiter);
}

function buildFallbackEnv(): Record<string, string> {
  const env = copyStringEnv();
  const fallbackPath = getFallbackPathEnv();
  if (fallbackPath) {
    env.PATH = fallbackPath;
    if (process.platform === "win32") {
      env.Path = fallbackPath;
    }
  }
  return env;
}

export function sanitizeDesktopChildEnv(
  env: Record<string, string>,
): Record<string, string> {
  const sanitized = { ...env };

  for (const key of APP_ONLY_ENV_KEYS) {
    delete sanitized[key];
  }

  for (const key of Object.keys(sanitized)) {
    if (APP_ONLY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete sanitized[key];
    }
  }

  return sanitized;
}

function parseNulSeparatedEnv(raw: Buffer): Record<string, string> {
  const parsed: Record<string, string> = {};
  const payload = raw.toString("utf8");
  const entries = payload.split("\0");
  for (const entry of entries) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    parsed[key] = entry.slice(separator + 1);
  }
  return parsed;
}

async function probeShellEnvironment(): Promise<Record<string, string>> {
  if (process.platform === "win32") {
    return copyStringEnv();
  }

  const spawnEnv: NodeJS.ProcessEnv = {
    ...copyStringEnv(),
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  const shellCandidates = buildShellCandidates(spawnEnv);
  let lastError: unknown = null;

  for (const shell of shellCandidates) {
    try {
      return await new Promise<Record<string, string>>((resolve, reject) => {
        const child = spawn(shell, ["-ilc", "env -0"], {
          env: spawnEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let outputSize = 0;
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
          reject(new ShellEnvTimeoutError(SHELL_ENV_TIMEOUT_MS));
        }, SHELL_ENV_TIMEOUT_MS);

        child.stdout?.on("data", (chunk: Buffer) => {
          outputSize += chunk.length;
          if (outputSize > MAX_ENV_OUTPUT_BYTES) {
            clearTimeout(timer);
            child.kill("SIGKILL");
            reject(new Error("[shell-env] Output exceeded safe limit"));
            return;
          }
          stdoutChunks.push(chunk);
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          if (timedOut) return;
          if (code !== 0) {
            const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
            reject(new Error(stderr || `[shell-env] Probe exited with code ${code ?? "unknown"}`));
            return;
          }

          const parsed = parseNulSeparatedEnv(Buffer.concat(stdoutChunks));
          if (!parsed.PATH && !parsed.Path) {
            reject(new Error("[shell-env] Probe succeeded but PATH was not found"));
            return;
          }
          resolve(parsed);
        });
      });
    } catch (error) {
      lastError = error;
      if (error instanceof ShellEnvTimeoutError) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("[shell-env] No usable shell candidate found");
}

export async function getShellEnvironment(options?: {
  forceRefresh?: boolean;
}): Promise<Record<string, string>> {
  const now = Date.now();
  const ttl = isFallbackCache ? fallbackCacheTtlMs : CACHE_TTL_MS;
  if (!options?.forceRefresh && cachedEnv && now - cacheTime < ttl) {
    return { ...cachedEnv };
  }

  if (!options?.forceRefresh && inFlightProbe) {
    return { ...(await inFlightProbe) };
  }

  const probe = (async () => {
    try {
      const probedEnv = await probeShellEnvironment();
      cachedEnv = probedEnv;
      cacheTime = Date.now();
      isFallbackCache = false;
      fallbackCacheTtlMs = FALLBACK_CACHE_TTL_MS;
      return { ...probedEnv };
    } catch (error) {
      const isTimeout = error instanceof ShellEnvTimeoutError;
      console.warn(
        `[shell-env] Failed to derive login shell env${isTimeout ? " (timed out)" : ""}: ${String(error)}. Falling back to process env.`,
      );
      const fallback = buildFallbackEnv();
      cachedEnv = fallback;
      cacheTime = Date.now();
      isFallbackCache = true;
      fallbackCacheTtlMs = isTimeout ? TIMEOUT_FALLBACK_CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS;
      return { ...fallback };
    } finally {
      inFlightProbe = null;
    }
  })();

  inFlightProbe = probe;
  return { ...(await probe) };
}

export async function getProcessEnvWithShellPath(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options?: { forceRefresh?: boolean },
): Promise<Record<string, string>> {
  const env = copyStringEnv(baseEnv);
  const shellEnv = await getShellEnvironment(options);

  for (const [key, value] of Object.entries(shellEnv)) {
    if (!(key in env)) {
      env[key] = value;
    }
  }

  const shellPath = shellEnv.PATH || shellEnv.Path;
  if (shellPath) {
    env.PATH = shellPath;
    if (process.platform === "win32") {
      env.Path = shellPath;
    }
  }

  return env;
}
