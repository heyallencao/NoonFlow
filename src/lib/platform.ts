import { execFileSync, execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface PiModelInfo {
  provider: string;
  id: string;
  value: string;
  label: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean;
  images: boolean;
}

export interface PiModelProbe {
  models: PiModelInfo[];
  error?: string;
}

let piModelProbeCache: { binary: string; expiresAt: number; value: PiModelProbe } | null = null;
let piModelProbeInFlight: Promise<PiModelProbe> | null = null;

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/**
 * Whether the given binary path requires shell execution.
 * On Windows, .cmd/.bat files cannot be executed directly by execFileSync.
 */
function needsShell(binPath: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(binPath);
}

function isExecutableFile(binPath: string): boolean {
  try {
    return fs.statSync(binPath).isFile();
  } catch {
    return false;
  }
}

function getNvmNodeBinDirs(): string[] {
  if (isWindows) {
    return [];
  }

  const nvmNodeVersionsDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    return fs.readdirSync(nvmNodeVersionsDir)
      .map((versionDir) => path.join(nvmNodeVersionsDir, versionDir, 'bin'))
      .filter((binDir) => {
        try {
          return fs.statSync(binDir).isDirectory();
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

/**
 * Extra PATH directories to search for Claude CLI and other tools.
 */
export function getExtraPathDirs(): string[] {
  const home = os.homedir();
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.claude', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.nvm', 'current', 'bin'),
    ];
  }
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/node/bin',
    '/usr/local/opt/node/bin',
    '/usr/bin',
    '/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'bin'),
    path.join(home, '.codex', 'bin'),
    ...getNvmNodeBinDirs(),
  ];
}

/**
 * Claude CLI candidate installation paths.
 */
export function getClaudeCandidatePaths(): string[] {
  const home = os.homedir();
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const exts = ['.cmd', '.exe', '.bat', ''];
    const baseDirs = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.claude', 'bin'),
      path.join(home, '.local', 'bin'),
    ];
    const candidates: string[] = [];
    for (const dir of baseDirs) {
      for (const ext of exts) {
        candidates.push(path.join(dir, 'claude' + ext));
      }
    }
    return candidates;
  }
  return [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/opt/homebrew/opt/node/bin/claude',
    '/usr/local/opt/node/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    path.join(home, '.nvm', 'current', 'bin', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
    ...getNvmNodeBinDirs().map((binDir) => path.join(binDir, 'claude')),
  ];
}

export function getCodexCandidatePaths(): string[] {
  const home = os.homedir();
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const exts = ['.cmd', '.exe', '.bat', ''];
    const baseDirs = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.codex', 'bin'),
    ];
    const candidates: string[] = [];
    for (const dir of baseDirs) {
      for (const ext of exts) {
        candidates.push(path.join(dir, 'codex' + ext));
      }
    }
    return candidates;
  }

  return [
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/opt/homebrew/opt/node/bin/codex',
    '/usr/local/opt/node/bin/codex',
    path.join(home, '.npm-global', 'bin', 'codex'),
    path.join(home, '.volta', 'bin', 'codex'),
    path.join(home, '.nvm', 'current', 'bin', 'codex'),
    path.join(home, '.local', 'bin', 'codex'),
    path.join(home, '.codex', 'bin', 'codex'),
    ...getNvmNodeBinDirs().map((binDir) => path.join(binDir, 'codex')),
  ];
}

export function getPiCandidatePaths(): string[] {
  const home = os.homedir();
  if (isWindows) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const exts = ['.cmd', '.exe', '.bat', ''];
    const baseDirs = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.local', 'bin'),
    ];
    return baseDirs.flatMap((dir) => exts.map((ext) => path.join(dir, `pi${ext}`)));
  }

  return [
    '/usr/local/bin/pi',
    '/opt/homebrew/bin/pi',
    '/opt/homebrew/opt/node/bin/pi',
    '/usr/local/opt/node/bin/pi',
    path.join(home, '.npm-global', 'bin', 'pi'),
    path.join(home, '.volta', 'bin', 'pi'),
    path.join(home, '.nvm', 'current', 'bin', 'pi'),
    path.join(home, '.local', 'bin', 'pi'),
    ...getNvmNodeBinDirs().map((binDir) => path.join(binDir, 'pi')),
  ];
}

function isPiCodingAgent(candidate: string): boolean {
  if (!isExecutableFile(candidate)) return false;
  try {
    const output = execFileSync(candidate, ['--help'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      stdio: 'pipe',
      env: { ...process.env, PATH: getExpandedPath() },
      shell: needsShell(candidate),
    }).toString();
    return /AI coding assistant/i.test(output) && /--mode\s+<mode>/i.test(output) && /--list-models/i.test(output);
  } catch {
    return false;
  }
}

/**
 * Build an expanded PATH string with extra directories, deduped and filtered.
 */
export function getExpandedPath(): string {
  const current = process.env.PATH || '';
  const parts = current.split(path.delimiter).filter(Boolean);
  const seen = new Set(parts);
  for (const p of getExtraPathDirs()) {
    if (p && !seen.has(p)) {
      parts.push(p);
      seen.add(p);
    }
  }
  return parts.join(path.delimiter);
}

// TTL cache for findClaudeBinary to avoid repeated filesystem probes.
// Only caches "found" results; "not found" is never cached so a fresh
// install is detected immediately on the next check.
let _cachedBinaryPath: string | undefined | null = null; // null = not cached
let _cachedBinaryTimestamp = 0;
let _cachedCodexBinaryPath: string | undefined | null = null;
let _cachedCodexBinaryTimestamp = 0;
let _cachedPiBinaryPath: string | undefined | null = null;
let _cachedPiBinaryTimestamp = 0;
const BINARY_CACHE_TTL = 60_000; // 60 seconds

/**
 * Find and validate the Claude CLI binary.
 * Positive results are cached for 60s; negative results are never cached.
 */
export function findClaudeBinary(): string | undefined {
  const now = Date.now();
  if (_cachedBinaryPath !== null && now - _cachedBinaryTimestamp < BINARY_CACHE_TTL) {
    return _cachedBinaryPath;
  }

  const found = _findClaudeBinaryUncached();
  if (found) {
    _cachedBinaryPath = found;
    _cachedBinaryTimestamp = now;
  } else {
    // Don't cache "not found" — user may install CLI any moment
    _cachedBinaryPath = null;
  }
  return found;
}

function _findClaudeBinaryUncached(): string | undefined {
  const envWithExpandedPath = { ...process.env, PATH: getExpandedPath() };

  // Try known candidate paths first
  for (const p of getClaudeCandidatePaths()) {
    try {
      execFileSync(p, ['--version'], {
        timeout: 3000,
        stdio: 'pipe',
        env: envWithExpandedPath,
        shell: needsShell(p),
      });
      return p;
    } catch {
      // not found, try next
    }
  }

  // Fallback: use `where` (Windows) or `which` (Unix) with expanded PATH
  try {
    const cmd = isWindows ? 'where' : '/usr/bin/which';
    const args = isWindows ? ['claude'] : ['claude'];
    const result = execFileSync(cmd, args, {
      timeout: 3000,
      stdio: 'pipe',
      env: envWithExpandedPath,
      shell: isWindows,
    });
    // where.exe may return multiple lines; try each with --version validation
    const lines = result.toString().trim().split(/\r?\n/);
    for (const line of lines) {
      const candidate = line.trim();
      if (!candidate) continue;
      try {
        execFileSync(candidate, ['--version'], {
          timeout: 3000,
          stdio: 'pipe',
          env: envWithExpandedPath,
          shell: needsShell(candidate),
        });
        return candidate;
      } catch {
        continue;
      }
    }
  } catch {
    // not found
  }

  return undefined;
}

export function findCodexBinary(): string | undefined {
  const now = Date.now();
  if (_cachedCodexBinaryPath !== null && now - _cachedCodexBinaryTimestamp < BINARY_CACHE_TTL) {
    return _cachedCodexBinaryPath;
  }

  const found = _findCodexBinaryUncached();
  if (found) {
    _cachedCodexBinaryPath = found;
    _cachedCodexBinaryTimestamp = now;
  } else {
    _cachedCodexBinaryPath = null;
  }
  return found;
}

export function findPiBinary(): string | undefined {
  const now = Date.now();
  if (_cachedPiBinaryPath !== null && now - _cachedPiBinaryTimestamp < BINARY_CACHE_TTL) {
    return _cachedPiBinaryPath;
  }

  for (const candidate of getPiCandidatePaths()) {
    if (isPiCodingAgent(candidate)) {
      _cachedPiBinaryPath = candidate;
      _cachedPiBinaryTimestamp = now;
      return candidate;
    }
  }

  try {
    const command = isWindows ? 'where' : '/usr/bin/which';
    const result = execFileSync(command, ['pi'], {
      timeout: 3000,
      stdio: 'pipe',
      env: { ...process.env, PATH: getExpandedPath() },
      shell: isWindows,
    });
    for (const line of result.toString().trim().split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate && isPiCodingAgent(candidate)) {
        _cachedPiBinaryPath = candidate;
        _cachedPiBinaryTimestamp = now;
        return candidate;
      }
    }
  } catch {
    // not found
  }

  _cachedPiBinaryPath = null;
  return undefined;
}

function _findCodexBinaryUncached(): string | undefined {
  for (const p of getCodexCandidatePaths()) {
    if (!isExecutableFile(p)) {
      continue;
    }
    // Codex wrappers can perform extra shell bootstrap work. Treat any
    // executable candidate as installed and leave version probing to the
    // explicit version path, which is separately cached.
    return p;
  }

  try {
    const cmd = isWindows ? 'where' : '/usr/bin/which';
    const result = execFileSync(cmd, ['codex'], {
      timeout: 3000,
      stdio: 'pipe',
      env: { ...process.env, PATH: getExpandedPath() },
      shell: isWindows,
    });
    const lines = result.toString().trim().split(/\r?\n/);
    for (const line of lines) {
      const candidate = line.trim();
      if (!candidate) continue;
      if (!isExecutableFile(candidate)) {
        continue;
      }
      return candidate;
    }
  } catch {
    // not found
  }

  return undefined;
}

/**
 * Execute claude --version and return the version string.
 * Handles .cmd shell execution on Windows.
 */
export async function getClaudeVersion(claudePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(claudePath, ['--version'], {
      timeout: 5000,
      env: { ...process.env, PATH: getExpandedPath() },
      shell: needsShell(claudePath),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getCodexVersion(codexPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(codexPath, ['--version'], {
      timeout: 5000,
      env: { ...process.env, PATH: getExpandedPath() },
      shell: needsShell(codexPath),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getPiVersion(piPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(piPath, ['--version'], {
      timeout: 5000,
      env: { ...process.env, PATH: getExpandedPath() },
      shell: needsShell(piPath),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseCompactTokenCount(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KM])?$/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2]?.toUpperCase() === 'M'
    ? 1_000_000
    : match[2]?.toUpperCase() === 'K'
    ? 1_000
    : 1;
  return Math.round(base * multiplier);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function parsePiModelListOutput(stdout: string): PiModelInfo[] {
  const lines = stripAnsi(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^provider\s{2,}model\s{2,}context\s{2,}max-out\s{2,}thinking\s{2,}images$/i.test(line));
  if (headerIndex < 0) return [];

  return lines.slice(headerIndex + 1).flatMap((line) => {
    const columns = line.split(/\s{2,}/).map((column) => column.trim());
    if (columns.length < 6) return [];
    const [provider, id, context, maxOutput, thinking, images] = columns;
    if (!provider || !id) return [];
    return [{
      provider,
      id,
      value: `${provider}/${id}`,
      label: `${id} · ${provider}`,
      contextWindow: parseCompactTokenCount(context),
      maxOutputTokens: parseCompactTokenCount(maxOutput),
      reasoning: thinking.toLowerCase() === 'yes',
      images: images.toLowerCase() === 'yes',
    }];
  });
}

async function listPiModelsUncached(piPath: string): Promise<PiModelProbe> {
  try {
    const { stdout, stderr } = await execFileAsync(piPath, ['--offline', '--list-models'], {
      cwd: os.homedir(),
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: getExpandedPath(),
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      },
      shell: needsShell(piPath),
    });
    const models = parsePiModelListOutput(stdout);
    const combined = `${stdout}\n${stderr}`;
    return {
      models,
      ...(models.length === 0 && !/No models available/i.test(combined)
        ? { error: stripAnsi(combined).trim() || 'Pi returned no model catalog' }
        : {}),
    };
  } catch (error) {
    const detail = error && typeof error === 'object'
      ? `${'stdout' in error ? String(error.stdout || '') : ''}\n${'stderr' in error ? String(error.stderr || '') : ''}`.trim()
      : '';
    return {
      models: [],
      error: stripAnsi(detail || (error instanceof Error ? error.message : String(error))).trim(),
    };
  }
}

export async function listPiModels(piPath: string): Promise<PiModelProbe> {
  const now = Date.now();
  if (piModelProbeCache?.binary === piPath && piModelProbeCache.expiresAt > now) {
    return piModelProbeCache.value;
  }
  if (piModelProbeInFlight) return piModelProbeInFlight;

  piModelProbeInFlight = listPiModelsUncached(piPath).then((value) => {
    piModelProbeCache = { binary: piPath, expiresAt: Date.now() + 30_000, value };
    return value;
  }).finally(() => {
    piModelProbeInFlight = null;
  });
  return piModelProbeInFlight;
}

/**
 * Find Git Bash (bash.exe) on Windows.
 * Returns the path to bash.exe or null if not found.
 */
export function findGitBash(): string | null {
  // 1. Check user-specified environment variable
  const envPath = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // 2. Check common installation paths
  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 3. Try to locate git.exe via `where git` and derive bash.exe path
  try {
    const result = execFileSync('where', ['git'], {
      timeout: 3000,
      stdio: 'pipe',
      shell: true,
    });
    const lines = result.toString().trim().split(/\r?\n/);
    for (const line of lines) {
      const gitExe = line.trim();
      if (!gitExe) continue;
      // git.exe is typically at <GitDir>\cmd\git.exe or <GitDir>\bin\git.exe
      const gitDir = path.dirname(path.dirname(gitExe));
      const bashPath = path.join(gitDir, 'bin', 'bash.exe');
      if (fs.existsSync(bashPath)) {
        return bashPath;
      }
    }
  } catch {
    // where git failed or timed out
  }

  return null;
}
