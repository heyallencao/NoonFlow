import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const smokeDurationMs = 8_000;

function fail(message, details) {
  console.error(message);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function collectAppBundles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const bundles = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      bundles.push(abs);
      continue;
    }
    if (entry.isDirectory()) {
      bundles.push(...collectAppBundles(abs));
    }
  }
  return bundles;
}

function pickNewest(paths) {
  return [...paths].sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function launchExecutable(appPath) {
  const executableName = path.basename(appPath, '.app');
  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName);

  if (!fs.existsSync(executablePath)) {
    fail(`App executable is missing: ${executablePath}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NOONFLOW_INSTALL_DRY_RUN: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let exited = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('exit', (code, signal) => {
      exited = true;
      resolve({
        appPath,
        executablePath,
        code,
        signal,
        stdout,
        stderr,
        status: 'exited',
      });
    });

    setTimeout(() => {
      if (exited) {
        return;
      }
      child.kill('SIGTERM');
      resolve({
        appPath,
        executablePath,
        code: 0,
        signal: 'SIGTERM',
        stdout,
        stderr,
        status: 'running',
      });
    }, smokeDurationMs);
  });
}

function listBundleProcesses(appPath) {
  const result = spawnSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes(`${appPath}/Contents/`));
}

function terminateBundleProcesses(appPath) {
  const processes = listBundleProcesses(appPath);
  for (const entry of processes) {
    const match = entry.match(/^(\d+)/);
    if (!match) continue;
    try {
      process.kill(Number(match[1]), 'SIGTERM');
    } catch {}
  }
}

function launchViaLaunchServices(appPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('open', ['-n', appPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NOONFLOW_INSTALL_DRY_RUN: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    setTimeout(() => {
      const processes = listBundleProcesses(appPath);
      const running = processes.length > 0;
      terminateBundleProcesses(appPath);
      resolve({
        appPath,
        stdout,
        stderr,
        processes,
        status: running ? 'running' : 'exited',
      });
    }, smokeDurationMs);
  });
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('Packaged launch verification skipped on non-darwin platform.');
    return;
  }

  const bundles = collectAppBundles(distRoot);
  if (bundles.length === 0) {
    fail(`No .app bundle found under ${distRoot}`);
  }

  const appPath = pickNewest(bundles);
  const directResult = await launchExecutable(appPath);
  const directCombined = `${directResult.stdout}\n${directResult.stderr}`.trim();

  if (/Failed to reserve virtual memory for CodeRange/i.test(directCombined)) {
    fail(`Packaged app hit the V8 CodeRange crash during smoke launch: ${appPath}`, directCombined);
  }

  if (directResult.status === 'exited') {
    fail(
      `Packaged app exited during direct smoke launch: ${appPath}`,
      directCombined || `exit=${directResult.code ?? 'unknown'} signal=${directResult.signal ?? 'none'}`,
    );
  }

  const openResult = await launchViaLaunchServices(appPath);
  const openCombined = `${openResult.stdout}\n${openResult.stderr}`.trim();
  if (openResult.status === 'exited') {
    fail(
      `Packaged app exited during LaunchServices smoke launch: ${appPath}`,
      openCombined || 'No app processes remained after open -n launch.',
    );
  }

  console.log(`Packaged app launch smoke check passed: ${appPath}`);
}

main().catch((error) => {
  fail('Packaged app launch smoke check failed.', error instanceof Error ? error.stack || error.message : String(error));
});
