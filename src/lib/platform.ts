import { execFileSync, execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

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
