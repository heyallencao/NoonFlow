import { spawnSync } from 'node:child_process';
import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function log(message) {
  console.log(`[postinstall] ${message}`);
}

function hasElectronRebuild() {
  try {
    require.resolve('@electron/rebuild');
    return true;
  } catch {
    return false;
  }
}

function fixNodePtySpawnHelperPermissions() {
  try {
    const nodeModulesPath = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');
    if (!statSync(nodeModulesPath, { throwIfNoEntry: false })?.isDirectory()) {
      return;
    }

    const platforms = readdirSync(nodeModulesPath);
    for (const platform of platforms) {
      const helperPath = join(nodeModulesPath, platform, 'spawn-helper');
      try {
        const stat = statSync(helperPath, { throwIfNoEntry: false });
        if (stat?.isFile()) {
          chmodSync(helperPath, 0o755);
          log(`Fixed spawn-helper permissions: ${platform}/spawn-helper`);
        }
      } catch {
        // Ignore missing spawn-helper for this platform
      }
    }
  } catch (error) {
    log(`Warning: Failed to fix spawn-helper permissions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  if (!hasElectronRebuild()) {
    log('Skip electron-rebuild (not installed, likely --omit=dev / NODE_ENV=production).');
    fixNodePtySpawnHelperPermissions();
    return;
  }

  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(bin, ['electron-rebuild', '-f', '-w', 'node-pty'], {
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`electron-rebuild failed with exit code ${result.status ?? 'unknown'}`);
  }

  fixNodePtySpawnHelperPermissions();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
