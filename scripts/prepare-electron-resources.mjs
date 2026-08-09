import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standaloneSrc = path.join(root, '.next', 'standalone');
const staticSrc = path.join(root, '.next', 'static');
const publicSrc = path.join(root, 'public');

const resourcesRoot = path.join(root, 'resources');
const standaloneDst = path.join(resourcesRoot, 'standalone');
const staticDst = path.join(standaloneDst, '.next', 'static');
const publicDst = path.join(standaloneDst, 'public');
const standaloneNodeModulesDst = path.join(standaloneDst, 'node_modules');
const runtimeNodeModulesDst = path.join(standaloneDst, 'runtime_node_modules');
const standaloneServerDst = path.join(standaloneDst, 'server.js');

function assertExists(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(message);
  }
}

function cleanResources() {
  fs.rmSync(resourcesRoot, { recursive: true, force: true });
  fs.mkdirSync(resourcesRoot, { recursive: true });
}

function copyRecursive(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    dereference: true,
  });
}

function isInsideBundle(targetPath) {
  const relative = path.relative(standaloneDst, targetPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function rewriteSymlink(linkPath, targetPath) {
  fs.unlinkSync(linkPath);
  fs.symlinkSync(path.relative(path.dirname(linkPath), targetPath), linkPath);
}

function walkSymlinks(dir, visitor) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      visitor(abs);
      continue;
    }
    if (entry.isDirectory()) {
      walkSymlinks(abs, visitor);
    }
  }
}

// Runtime modules that must be copied from root node_modules into standalone.
// Keep this list limited to modules that the packaged app cannot load from
// app.asar/app.asar.unpacked. Everything else should resolve from the main app bundle.
const RUNTIME_MODULES = ['node-pty', 'better-sqlite3', 'bindings', 'file-uri-to-path'];

// Dev-only modules that should be removed from runtime to reduce bundle size.
// These are dependencies that Next.js tracing incorrectly includes but are not needed at runtime.
const DEV_ONLY_MODULES = ['typescript', 'tsx'];
const EXTERNAL_CLI_RUNTIME_PACKAGE_PATTERNS = [
  { scope: '@openai', pattern: /^codex-(?:darwin|linux|win32)-/ },
  { scope: '@anthropic-ai', pattern: /^claude-agent-sdk-(?:darwin|linux|win32)-/ },
];

function relocateStandaloneNodeModules() {
  if (!fs.existsSync(standaloneNodeModulesDst)) {
    return;
  }

  fs.rmSync(runtimeNodeModulesDst, { recursive: true, force: true });
  fs.renameSync(standaloneNodeModulesDst, runtimeNodeModulesDst);
}

function ensureStandaloneNodeModulesLink() {
  fs.rmSync(standaloneNodeModulesDst, { recursive: true, force: true });
  fs.symlinkSync(path.relative(standaloneDst, runtimeNodeModulesDst), standaloneNodeModulesDst, 'junction');
}

function cleanDevModulesFromRuntime() {
  if (!fs.existsSync(runtimeNodeModulesDst)) {
    return;
  }

  for (const mod of DEV_ONLY_MODULES) {
    const modPath = path.join(runtimeNodeModulesDst, mod);
    if (fs.existsSync(modPath)) {
      console.log(`  Removing dev-only module: ${mod}`);
      fs.rmSync(modPath, { recursive: true, force: true });
    }
  }

  // Also clean up @types directory if it exists (contains only type definitions)
  const typesPath = path.join(runtimeNodeModulesDst, '@types');
  if (fs.existsSync(typesPath)) {
    console.log('  Removing @types (type definitions not needed at runtime)');
    fs.rmSync(typesPath, { recursive: true, force: true });
  }
}

function pruneExternalCliRuntimePackages() {
  const nodeModulesRoots = [];

  function collectNodeModulesRoots(dir) {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === 'runtime_node_modules') {
        nodeModulesRoots.push(abs);
      }
      collectNodeModulesRoots(abs);
    }
  }

  collectNodeModulesRoots(standaloneDst);

  for (const nodeModulesRoot of nodeModulesRoots) {
    for (const { scope, pattern } of EXTERNAL_CLI_RUNTIME_PACKAGE_PATTERNS) {
      const scopePath = path.join(nodeModulesRoot, scope);
      if (!fs.existsSync(scopePath)) continue;

      for (const packageName of fs.readdirSync(scopePath)) {
        if (!pattern.test(packageName)) continue;
        const packagePath = path.join(scopePath, packageName);
        console.log(`  Removing external CLI runtime package: ${path.relative(standaloneDst, packagePath)}`);
        fs.rmSync(packagePath, { recursive: true, force: true });
      }
    }
  }
}

function copyNativeModules() {
  const srcNodeModules = path.join(root, 'node_modules');
  const dstNodeModules = runtimeNodeModulesDst;

  for (const mod of RUNTIME_MODULES) {
    const srcPath = path.join(srcNodeModules, mod);
    const dstPath = path.join(dstNodeModules, mod);
    if (fs.existsSync(srcPath)) {
      console.log(`  Copying native module: ${mod}`);
      fs.rmSync(dstPath, { recursive: true, force: true });
      copyRecursive(srcPath, dstPath);
    }
  }
}

function pruneStandaloneModulesThatShouldResolveFromAppBundle() {
  for (const mod of ['next', 'styled-jsx']) {
    const modPath = path.join(runtimeNodeModulesDst, mod);
    if (fs.existsSync(modPath)) {
      fs.rmSync(modPath, { recursive: true, force: true });
    }
  }
}

function patchStandaloneServerNodePath() {
  if (!fs.existsSync(standaloneServerDst)) {
    throw new Error(`Missing standalone server entry: ${standaloneServerDst}`);
  }

  const source = fs.readFileSync(standaloneServerDst, 'utf8');
  const marker = "process.chdir(__dirname)\n";
  const bootstrap = [
    "process.chdir(__dirname)",
    "",
    "const Module = require('module')",
    "const runtimeNodeModules = path.join(__dirname, 'runtime_node_modules')",
    "const workspaceNodeModules = path.join(__dirname, '..', '..', 'node_modules')",
    "const packagedNodeModules = path.join(__dirname, '..', 'app.asar', 'node_modules')",
    "const unpackedNodeModules = path.join(__dirname, '..', 'app.asar.unpacked', 'node_modules')",
    "const nodePathEntries = [runtimeNodeModules, workspaceNodeModules, packagedNodeModules, unpackedNodeModules]",
    "process.env.NODE_PATH = process.env.NODE_PATH",
    "  ? `${nodePathEntries.join(path.delimiter)}${path.delimiter}${process.env.NODE_PATH}`",
    "  : nodePathEntries.join(path.delimiter)",
    "Module._initPaths()",
  ].join('\n');

  if (!source.includes(marker)) {
    throw new Error(`Unable to patch standalone server bootstrap in ${standaloneServerDst}`);
  }

  fs.writeFileSync(standaloneServerDst, source.replace(marker, `${bootstrap}\n`), 'utf8');
}

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

function findHashedExternalModuleIds() {
  const chunksDir = path.join(standaloneDst, '.next', 'server', 'chunks');
  const ids = new Set();
  const hashedModuleIdPattern = /require\("([^"]+-[a-f0-9]{16})"\)/g;

  for (const filePath of listJsFilesRecursively(chunksDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = hashedModuleIdPattern.exec(content)) !== null) {
      ids.add(match[1]);
    }
  }

  return Array.from(ids).sort();
}

function patchHashedExternalModules() {
  const ids = findHashedExternalModuleIds();
  if (ids.length === 0) {
    return;
  }

  for (const id of ids) {
    const baseModule = id.replace(/-[a-f0-9]{16}$/, '');
    const baseModulePath = path.join(runtimeNodeModulesDst, baseModule);
    const aliasPath = path.join(runtimeNodeModulesDst, id);

    if (!fs.existsSync(baseModulePath)) {
      throw new Error(
        `Cannot create external module alias "${id}" because base module "${baseModule}" is missing at ${baseModulePath}`,
      );
    }

    fs.rmSync(aliasPath, { recursive: true, force: true });
    fs.mkdirSync(aliasPath, { recursive: true });
    fs.writeFileSync(
      path.join(aliasPath, 'index.js'),
      `module.exports = require(${JSON.stringify(baseModule)});\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(aliasPath, 'package.json'),
      JSON.stringify(
        {
          name: id,
          private: true,
          main: 'index.js',
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  console.log(`  Patched hashed externals: ${ids.join(', ')}`);
}

function repairStandaloneSymlinks() {
  walkSymlinks(standaloneDst, (linkPath) => {
    const rawTarget = fs.readlinkSync(linkPath);
    const absoluteTarget = path.isAbsolute(rawTarget)
      ? rawTarget
      : path.resolve(path.dirname(linkPath), rawTarget);

    if (isInsideBundle(absoluteTarget)) {
      rewriteSymlink(linkPath, absoluteTarget);
      return;
    }

    const hashedAliasMatch = linkPath.match(/\.next\/node_modules\/([^/]+)-[a-f0-9]{16}$/);
    if (hashedAliasMatch) {
      const baseModule = hashedAliasMatch[1];
      const baseModulePath = path.join(runtimeNodeModulesDst, baseModule);
      if (fs.existsSync(baseModulePath)) {
        rewriteSymlink(linkPath, baseModulePath);
        return;
      }
    }

    // External symlinks are not portable inside the bundle.
    fs.unlinkSync(linkPath);
  });
}

function main() {
  assertExists(
    standaloneSrc,
    'Missing .next/standalone. Run `next build` before preparing Electron resources.',
  );
  assertExists(
    staticSrc,
    'Missing .next/static. Run `next build` before preparing Electron resources.',
  );

  cleanResources();

  copyRecursive(standaloneSrc, standaloneDst);
  relocateStandaloneNodeModules();
  cleanDevModulesFromRuntime();
  pruneExternalCliRuntimePackages();
  pruneStandaloneModulesThatShouldResolveFromAppBundle();
  fs.mkdirSync(path.dirname(staticDst), { recursive: true });
  copyRecursive(staticSrc, staticDst);

  if (fs.existsSync(publicSrc)) {
    copyRecursive(publicSrc, publicDst);
  }

  // Copy native modules required at runtime
  copyNativeModules();
  patchHashedExternalModules();
  repairStandaloneSymlinks();
  ensureStandaloneNodeModulesLink();
  patchStandaloneServerNodePath();

  fs.writeFileSync(path.join(resourcesRoot, '.gitkeep'), '', 'utf8');

  console.log('Prepared Electron resources:');
  console.log(`- ${standaloneDst}`);
  console.log(`- ${staticDst}`);
  if (fs.existsSync(publicDst)) {
    console.log(`- ${publicDst}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
