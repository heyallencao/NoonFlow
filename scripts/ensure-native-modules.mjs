import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const projectRoot = process.cwd();
const require = createRequire(path.join(projectRoot, 'package.json'));

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function isExternalNodeModulesSymlink(nodeModulesPath) {
  try {
    const stat = fs.lstatSync(nodeModulesPath);
    if (!stat.isSymbolicLink()) {
      return false;
    }

    const realNodeModulesPath = fs.realpathSync(nodeModulesPath);
    return !realNodeModulesPath.startsWith(`${projectRoot}${path.sep}`);
  } catch {
    return false;
  }
}

function cloneNodeModules(sourceNodeModulesPath, targetNodeModulesPath) {
  fs.rmSync(targetNodeModulesPath, { recursive: true, force: true });
  fs.cpSync(sourceNodeModulesPath, targetNodeModulesPath, {
    recursive: true,
    dereference: false,
    errorOnExist: false,
    force: true,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

function filesMatch(leftPath, rightPath) {
  const left = readFileIfExists(leftPath);
  const right = readFileIfExists(rightPath);
  return left !== null && right !== null && left === right;
}

function parseWorktreeList(output) {
  const worktrees = [];
  let current = null;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (current?.path) {
        worktrees.push(current);
      }
      current = null;
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current?.path) {
        worktrees.push(current);
      }
      current = { path: line.slice('worktree '.length) };
    }
  }

  if (current?.path) {
    worktrees.push(current);
  }

  return worktrees;
}

function getReusableNodeModulesSource() {
  const currentNodeModulesPath = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(currentNodeModulesPath) && !isExternalNodeModulesSymlink(currentNodeModulesPath)) {
    return null;
  }

  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  const currentPackageLockPath = path.join(projectRoot, 'package-lock.json');
  const currentPackageJsonPath = path.join(projectRoot, 'package.json');
  const worktrees = parseWorktreeList(result.stdout);

  for (const worktree of worktrees) {
    const candidateRoot = worktree.path;
    if (!candidateRoot || path.resolve(candidateRoot) === projectRoot) {
      continue;
    }

    const candidateNodeModulesPath = path.join(candidateRoot, 'node_modules');
    if (!fs.existsSync(candidateNodeModulesPath)) {
      continue;
    }

    const packageLockMatches = filesMatch(
      currentPackageLockPath,
      path.join(candidateRoot, 'package-lock.json'),
    );
    const packageJsonMatches = filesMatch(
      currentPackageJsonPath,
      path.join(candidateRoot, 'package.json'),
    );

    if (!packageLockMatches && !packageJsonMatches) {
      continue;
    }

    return candidateNodeModulesPath;
  }

  return null;
}

function ensureNodeModulesAvailable() {
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(nodeModulesPath) && !isExternalNodeModulesSymlink(nodeModulesPath)) {
    return;
  }

  const reusableNodeModulesSource = getReusableNodeModulesSource();
  if (!reusableNodeModulesSource) {
    throw new Error(
      [
        `No local node_modules found in ${projectRoot}.`,
        'This worktree is missing dependencies and no compatible sibling worktree could be reused.',
        'Run `npm install` in this worktree or in the main NoonFlow workspace first.',
      ].join(' '),
    );
  }

  cloneNodeModules(reusableNodeModulesSource, nodeModulesPath);
  log(`Cloned node_modules from ${reusableNodeModulesSource}`);
}

function resolveBetterSqlitePackageRoot() {
  return path.dirname(require.resolve('better-sqlite3/package.json'));
}

function log(message) {
  console.log(`[native:ensure] ${message}`);
}

function runNpmRebuild(packages) {
  const result = spawnSync('npm', ['rebuild', ...packages], {
    cwd: projectRoot,
    env: buildProbeEnv(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`npm rebuild failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function buildProbeEnv() {
  const env = { ...process.env };
  for (const key of [
    'npm_config_runtime',
    'npm_config_target',
    'npm_config_disturl',
    'npm_config_devdir',
    'npm_config_arch',
    'ELECTRON_RUN_AS_NODE',
  ]) {
    delete env[key];
  }
  return env;
}

function isAbiMismatchError(error) {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error);

  return (
    text.includes('NODE_MODULE_VERSION') ||
    text.includes('ERR_DLOPEN_FAILED') ||
    text.includes('was compiled against a different Node.js version') ||
    text.includes('Could not locate the bindings file') ||
    text.includes('probe terminated by signal SIGKILL') ||
    text.includes('probe terminated by signal SIGSEGV') ||
    text.includes('probe terminated by signal SIGABRT')
  );
}

function resolveLocalBetterSqliteBinding() {
  const betterSqlitePackageRoot = resolveBetterSqlitePackageRoot();
  const candidates = [
    path.join(
      betterSqlitePackageRoot,
      'build',
      'Release',
      'better_sqlite3.node',
    ),
    path.join(
      betterSqlitePackageRoot,
      'build',
      'Debug',
      'better_sqlite3.node',
    ),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function probeBetterSqlite3() {
  const nativeBinding = resolveLocalBetterSqliteBinding();
  const probeScript = `
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const projectRoot = ${JSON.stringify(projectRoot)};
    const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
    const Database = requireFromProject('better-sqlite3');
    const db = new Database(':memory:', ${nativeBinding ? `{ nativeBinding: ${JSON.stringify(nativeBinding)} }` : 'undefined'});
    const row = db.prepare('SELECT 1 AS x').get();
    db.close();
    if (!row || row.x !== 1) {
      throw new Error('better-sqlite3 returned an unexpected result');
    }
  `;

  const result = spawnSync(process.execPath, ['-e', probeScript], {
    cwd: projectRoot,
    env: buildProbeEnv(),
    encoding: 'utf8',
  });

  if (result.status === 0 && !result.signal) {
    return { ok: true };
  }

  const messageParts = [];
  if (result.signal) {
    messageParts.push(`probe terminated by signal ${result.signal}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    messageParts.push(`probe exited with code ${result.status}`);
  }
  if (result.stderr?.trim()) {
    messageParts.push(result.stderr.trim());
  }
  if (result.stdout?.trim()) {
    messageParts.push(result.stdout.trim());
  }

  return {
    ok: false,
    error: new Error(messageParts.join('\n') || 'better-sqlite3 probe failed'),
  };
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function main() {
  log(`Node ${process.version} (ABI ${process.versions.modules})`);
  ensureNodeModulesAvailable();

  const firstProbe = probeBetterSqlite3();
  if (firstProbe.ok) {
    log('better-sqlite3 is ready');
    return;
  }

  if (!isAbiMismatchError(firstProbe.error)) {
    throw new Error(
      `better-sqlite3 failed for non-ABI reason: ${formatError(firstProbe.error)}`,
    );
  }

  log('Detected ABI mismatch for better-sqlite3, rebuilding...');
  runNpmRebuild(['better-sqlite3']);

  const localBinding = resolveLocalBetterSqliteBinding();
  if (!localBinding) {
    const betterSqlitePackageRoot = resolveBetterSqlitePackageRoot();
    throw new Error(
      `better-sqlite3 rebuild completed but no local native binding was found under ${betterSqlitePackageRoot}`,
    );
  }

  const secondProbe = probeBetterSqlite3();
  if (!secondProbe.ok) {
    throw new Error(
      `better-sqlite3 is still not loadable after rebuild: ${formatError(secondProbe.error)}`,
    );
  }

  log('better-sqlite3 rebuilt successfully');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[native:ensure] ${message}`);
  process.exit(1);
}
