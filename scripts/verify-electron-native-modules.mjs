import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetArch = process.env.NOONFLOW_TARGET_ARCH || process.env.MONOLITH_TARGET_ARCH || process.arch;
const standaloneBetterSqlite3 = path.join(
  root,
  'resources',
  'standalone',
  'runtime_node_modules',
  'better-sqlite3',
);
const standaloneRoot = path.join(root, 'resources', 'standalone');
const standaloneNodeModules = path.join(standaloneRoot, 'runtime_node_modules');
const standaloneServerChunksDir = path.join(
  standaloneRoot,
  '.next',
  'server',
  'chunks',
);

function listJsFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFilesRecursively(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith('.js')) {
      files.push(abs);
    }
  }
  return files;
}

function collectHashedExternalIds() {
  const ids = new Set();
  const hashedModuleIdPattern = /require\("([^"]+-[a-f0-9]{16})"\)/g;

  for (const filePath of listJsFilesRecursively(standaloneServerChunksDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = hashedModuleIdPattern.exec(content)) !== null) {
      ids.add(match[1]);
    }
  }

  return Array.from(ids).sort();
}

function verifyNativeBinaryArch(filePath) {
  if (process.platform !== 'darwin') {
    return;
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Native binary missing: ${filePath}`);
  }

  const expectedArch = targetArch === 'x64' ? 'x86_64' : targetArch;
  const result = spawnSync('lipo', ['-info', filePath], {
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to inspect binary architecture for ${filePath}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedArch)) {
    throw new Error(
      `Native binary architecture mismatch for ${filePath}. Expected ${expectedArch}, got: ${output.trim()}`,
    );
  }
}

function validateNativeBinaryArchitectures() {
  const candidates = [
    path.join(
      standaloneRoot,
      'runtime_node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
    path.join(
      standaloneRoot,
      'runtime_node_modules',
      'node-pty',
      'build',
      'Release',
      'pty.node',
    ),
  ];

  for (const candidate of candidates) {
    verifyNativeBinaryArch(candidate);
  }
}

function buildProbeScript() {
  const standalonePathLiteral = JSON.stringify(standaloneBetterSqlite3);
  const standaloneRootLiteral = JSON.stringify(standaloneRoot);
  const hashedExternalIdsLiteral = JSON.stringify(collectHashedExternalIds());

  return `
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function ok(message) {
  console.log('[electron:native:preflight] ' + message);
}

function fail(message, error) {
  console.error('[electron:native:preflight] ' + message);
  if (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  }
  process.exitCode = 1;
}

ok('Electron ' + process.versions.electron + ', Node ' + process.versions.node + ', ABI ' + process.versions.modules);

try {
  require('better-sqlite3');
  ok('root better-sqlite3 load OK');
} catch (error) {
  fail('root better-sqlite3 load failed', error);
}

try {
  require('node-pty');
  ok('root node-pty load OK');
} catch (error) {
  fail('root node-pty load failed', error);
}

const standalonePath = ${standalonePathLiteral};
if (!fs.existsSync(standalonePath)) {
  fail('standalone better-sqlite3 path missing: ' + standalonePath);
} else {
  try {
    require(standalonePath);
    ok('standalone better-sqlite3 load OK');
  } catch (error) {
    fail('standalone better-sqlite3 load failed', error);
  }
}

const standaloneRoot = ${standaloneRootLiteral};
const hashedExternalIds = ${hashedExternalIdsLiteral};
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-standalone-preflight-'));
const standaloneNodeModules = path.join(standaloneRoot, 'runtime_node_modules');
const isolatedNodeModules = path.join(tempRoot, 'node_modules');

function isolatedRequire(moduleId) {
  return require(path.join(isolatedNodeModules, moduleId));
}

try {
  fs.mkdirSync(isolatedNodeModules, { recursive: true });
  const modulesToCopy = ['bindings', 'file-uri-to-path', 'better-sqlite3', 'node-pty', ...hashedExternalIds];
  for (const moduleId of modulesToCopy) {
    fs.cpSync(
      path.join(standaloneNodeModules, moduleId),
      path.join(isolatedNodeModules, moduleId),
      {
        recursive: true,
        force: true,
        dereference: true,
      },
    );
  }

  // Validate in an isolated location to prevent accidental fallback to the
  // project root node_modules during packaging preflight.
  isolatedRequire('bindings');
  isolatedRequire('file-uri-to-path');
  isolatedRequire('better-sqlite3');
  isolatedRequire('node-pty');
  for (const id of hashedExternalIds) {
    isolatedRequire(id);
  }

  ok('isolated standalone runtime loads OK');
} catch (error) {
  fail('isolated standalone runtime load failed', error);
} finally {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
`;
}

function runProbe() {
  const electronBin =
    process.platform === 'win32'
      ? path.join(root, 'node_modules', '.bin', 'electron.cmd')
      : path.join(root, 'node_modules', '.bin', 'electron');

  const probeScript = buildProbeScript();
  const result = spawnSync(electronBin, ['-e', probeScript], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Electron native module preflight failed with exit code ${result.status ?? 'unknown'}`,
    );
  }
}

function main() {
  if (!fs.existsSync(standaloneRoot)) {
    throw new Error(
      'Missing resources/standalone. Run `npm run electron:prepare` before native preflight.',
    );
  }

  const hashedExternalIds = collectHashedExternalIds();
  const missingHashedExternalAliases = hashedExternalIds.filter(
    (id) => !fs.existsSync(path.join(standaloneNodeModules, id)),
  );
  if (missingHashedExternalAliases.length > 0) {
    throw new Error(
      `Missing hashed external alias modules:\n${missingHashedExternalAliases
        .map((id) => path.join(standaloneNodeModules, id))
        .join('\n')}\nRun \`npm run electron:prepare\` and ensure external alias patching succeeds.`,
    );
  }

  validateNativeBinaryArchitectures();
  if (targetArch === process.arch) {
    runProbe();
  } else {
    console.log(
      `[electron:native:preflight] Skipping runtime load probe for target arch ${targetArch} on host arch ${process.arch}.`,
    );
  }
  console.log('[electron:native:preflight] all native module checks passed.');
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
