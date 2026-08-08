import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const standaloneRoot = path.join(root, 'resources', 'standalone');
const moduleDir = path.join(standaloneRoot, 'runtime_node_modules');
const rebuildNodeModulesLink = path.join(standaloneRoot, 'node_modules');
const targetArch = process.env.NOONFLOW_TARGET_ARCH || process.env.MONOLITH_TARGET_ARCH || process.arch;
const require = createRequire(import.meta.url);
const electronPkg = require('electron/package.json');
const electronVersion = process.env.NOONFLOW_ELECTRON_VERSION || process.env.MONOLITH_ELECTRON_VERSION || electronPkg.version;

function log(message) {
  console.log(`[standalone:native] ${message}`);
}

function run() {
  if (!fs.existsSync(standaloneRoot)) {
    throw new Error(
      `Missing standalone resources at ${standaloneRoot}. Run \`npm run electron:prepare\` first.`,
    );
  }

  if (!fs.existsSync(moduleDir)) {
    throw new Error(
      `Missing standalone runtime node_modules at ${moduleDir}. Run \`npm run electron:prepare\` first.`,
    );
  }

  const electronRebuildBin =
    process.platform === 'win32'
      ? path.join(root, 'node_modules', '.bin', 'electron-rebuild.cmd')
      : path.join(root, 'node_modules', '.bin', 'electron-rebuild');

  if (!fs.existsSync(electronRebuildBin)) {
    throw new Error(`electron-rebuild binary not found: ${electronRebuildBin}`);
  }

  log(`Rebuilding standalone native modules for Electron ${electronVersion}, arch ${targetArch}...`);
  fs.rmSync(rebuildNodeModulesLink, { recursive: true, force: true });
  fs.symlinkSync(path.relative(standaloneRoot, moduleDir), rebuildNodeModulesLink, 'junction');

  const result = spawnSync(
    electronRebuildBin,
    [
      '-f',
      '-v',
      electronVersion,
      '-a',
      targetArch,
      '-m',
      standaloneRoot,
      '-o',
      'better-sqlite3,node-pty',
      '-t',
      'prod,optional',
    ],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  if (result.error) {
    fs.rmSync(rebuildNodeModulesLink, { recursive: true, force: true });
    throw result.error;
  }
  if (result.status !== 0) {
    fs.rmSync(rebuildNodeModulesLink, { recursive: true, force: true });
    throw new Error(
      `electron-rebuild failed with exit code ${result.status ?? 'unknown'}`,
    );
  }

  fs.rmSync(rebuildNodeModulesLink, { recursive: true, force: true });
  fs.symlinkSync(path.relative(standaloneRoot, moduleDir), rebuildNodeModulesLink, 'junction');

  log('Standalone native module rebuild completed.');
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[standalone:native] ${message}`);
  process.exit(1);
}
