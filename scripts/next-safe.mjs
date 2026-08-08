import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const LOCK_POLL_INTERVAL_MS = 250;
const DEFAULT_LOCK_WAIT_MS = 15_000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getLockHolderPids(lockPath) {
  if (process.platform === 'win32') {
    return [];
  }

  const result = spawnSync('lsof', ['-t', lockPath], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    return [];
  }

  return Array.from(new Set(result.stdout.split(/\s+/).map((value) => value.trim()).filter(Boolean)));
}

function getPidCommand(pid) {
  if (process.platform === 'win32') {
    return null;
  }

  const result = spawnSync('ps', ['-p', pid, '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function waitForLockRelease(lockPath, waitMs) {
  const startMs = Date.now();
  let warned = false;

  while (Date.now() - startMs < waitMs) {
    const pids = getLockHolderPids(lockPath);
    if (pids.length === 0) {
      return { released: true };
    }

    if (!warned) {
      console.warn(
        `[next-safe] Detected active lock at ${lockPath} held by PID(s): ${pids.join(', ')}. Waiting up to ${Math.ceil(
          waitMs / 1000
        )}s for release...`
      );
      warned = true;
    }

    sleep(LOCK_POLL_INTERVAL_MS);
  }

  const pids = getLockHolderPids(lockPath);
  return {
    released: pids.length === 0,
    pids,
    commands: pids.map((pid) => getPidCommand(pid)).filter(Boolean),
  };
}

if (args.length === 0) {
  console.error('[next-safe] Missing next subcommand. Usage: node scripts/next-safe.mjs <dev|build|start> [...args]');
  process.exit(1);
}

const nextBin =
  process.platform === 'win32'
    ? path.join(process.cwd(), 'node_modules', '.bin', 'next.cmd')
    : path.join(process.cwd(), 'node_modules', '.bin', 'next');
const nextCliBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const nextBuildShim = path.join(process.cwd(), 'scripts', 'next-build-shim.mjs');

const env = { ...process.env };
delete env.__NEXT_PRIVATE_STANDALONE_CONFIG;

if (args[0] === 'build' && args.length === 1) {
  delete env.TURBOPACK;

  const result = spawnSync(
    process.execPath,
    ['--import', nextBuildShim, nextCliBin, 'build', '--webpack'],
    {
      stdio: 'inherit',
      env,
      shell: false,
    },
  );

  if (result.error) {
    console.error('[next-safe] Failed to launch next build:', result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (args[0] === 'dev') {
  env.NODE_ENV = 'development';

  const lockPath = path.join(process.cwd(), '.next', 'dev', 'lock');
  const waitMs = parsePositiveInt(process.env.NEXT_SAFE_LOCK_WAIT_MS ?? '', DEFAULT_LOCK_WAIT_MS);
  const lockResult = waitForLockRelease(lockPath, waitMs);

  if (!lockResult.released) {
    console.error(`[next-safe] Unable to acquire Next.js dev lock after waiting ${Math.ceil(waitMs / 1000)}s.`);
    if (lockResult.pids?.length) {
      console.error(`[next-safe] Lock holder PID(s): ${lockResult.pids.join(', ')}`);
    }
    if (lockResult.commands?.length) {
      for (const command of lockResult.commands) {
        console.error(`[next-safe] ${command}`);
      }
    }
    process.exit(1);
  }
}

const result = spawnSync(nextBin, args, {
  stdio: 'inherit',
  env,
  shell: false,
});

if (result.error) {
  console.error('[next-safe] Failed to launch next:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
