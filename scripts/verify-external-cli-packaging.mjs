import fs from 'node:fs';
import path from 'node:path';
import { listPackage, statFile } from '@electron/asar';

const root = process.cwd();
const distRoot = path.join(root, 'dist');
const requiredSdkPackages = [
  '@openai/codex-sdk',
  '@anthropic-ai/claude-agent-sdk',
];
const forbiddenPackagePattern = /(?:^|\/)(?:node_modules|runtime_node_modules)\/(?:@openai\/codex-(?:darwin|linux|win32)-[^/]+|@anthropic-ai\/claude-agent-sdk-(?:darwin|linux|win32)-[^/]+)(?:\/|$)/;

function normalizePath(targetPath) {
  return targetPath.split(path.sep).join('/');
}

function collectAppBundles(dir) {
  if (!fs.existsSync(dir)) return [];

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

function directoryBytes(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      bytes += directoryBytes(abs);
    } else if (entry.isFile()) {
      bytes += fs.statSync(abs).size;
    }
  }
  return bytes;
}

function packageNameFromPath(packagePath) {
  const normalized = normalizePath(packagePath);
  const markerMatch = normalized.match(/\/(?:node_modules|runtime_node_modules)\/([^/]+(?:\/[^/]+)?)/);
  if (markerMatch) {
    return markerMatch[1];
  }
  const marker = 'node_modules/';
  const markerIndex = normalized.lastIndexOf(marker);
  const relative = markerIndex >= 0
    ? normalized.slice(markerIndex + marker.length)
    : normalized.replace(/^node_modules\//, '');
  const parts = relative.split('/');
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1] || ''}` : parts[0];
}

function scanFilesystem(appPath) {
  const matches = [];
  const sdkPackages = new Set();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;

      const normalized = normalizePath(abs);
      const packageName = packageNameFromPath(normalized);
      if (requiredSdkPackages.includes(packageName)) {
        sdkPackages.add(packageName);
      }
      if (forbiddenPackagePattern.test(normalized)) {
        matches.push({ location: abs, bytes: directoryBytes(abs) });
        continue;
      }
      walk(abs);
    }
  }

  walk(appPath);
  return { matches, sdkPackages };
}

function packageRootFromAsarEntry(entry) {
  const normalized = entry.replace(/^\//, '');
  const match = normalized.match(
    /^(?:.*\/)?node_modules\/(?:@openai\/codex-(?:darwin|linux|win32)-[^/]+|@anthropic-ai\/claude-agent-sdk-(?:darwin|linux|win32)-[^/]+)/,
  );
  return match?.[0] || null;
}

function scanAsar(appPath) {
  const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    return { matches: [], sdkPackages: new Set() };
  }

  const entries = listPackage(asarPath).map((entry) => entry.replace(/^\//, ''));
  const sdkPackages = new Set();
  const forbiddenRoots = new Set();

  for (const entry of entries) {
    for (const packageName of requiredSdkPackages) {
      if (entry === `node_modules/${packageName}` || entry.startsWith(`node_modules/${packageName}/`)) {
        sdkPackages.add(packageName);
      }
    }
    const forbiddenRoot = packageRootFromAsarEntry(entry);
    if (forbiddenRoot) forbiddenRoots.add(forbiddenRoot);
  }

  const matches = [];
  for (const forbiddenRoot of forbiddenRoots) {
    let bytes = 0;
    for (const entry of entries) {
      if (entry !== forbiddenRoot && !entry.startsWith(`${forbiddenRoot}/`)) continue;
      try {
        const stat = statFile(asarPath, entry);
        if (!stat.unpacked && stat.size) bytes += stat.size;
      } catch {
        // Directory entries and unpacked metadata may not expose a file size.
      }
    }
    matches.push({ location: `${asarPath}:/${forbiddenRoot}`, bytes });
  }

  return { matches, sdkPackages };
}

function verifyApp(appPath) {
  const filesystem = scanFilesystem(appPath);
  const asar = scanAsar(appPath);
  const matches = [...filesystem.matches, ...asar.matches];
  const sdkPackages = new Set([...filesystem.sdkPackages, ...asar.sdkPackages]);
  const forbiddenBytes = matches.reduce((sum, match) => sum + match.bytes, 0);

  console.log(`[external-cli-packaging] app=${appPath}`);
  console.log(`[external-cli-packaging] forbidden_matches=${matches.length}`);
  console.log(`[external-cli-packaging] forbidden_bytes=${forbiddenBytes}`);
  for (const match of matches) {
    console.log(`[external-cli-packaging] forbidden=${match.location} bytes=${match.bytes}`);
  }
  for (const packageName of requiredSdkPackages) {
    console.log(
      `[external-cli-packaging] sdk_main ${packageName}=${sdkPackages.has(packageName) ? 'present' : 'missing'}`,
    );
  }

  const missingSdkPackages = requiredSdkPackages.filter((packageName) => !sdkPackages.has(packageName));
  if (matches.length > 0 || missingSdkPackages.length > 0) {
    const reasons = [];
    if (matches.length > 0) reasons.push(`${matches.length} forbidden platform runtime package(s)`);
    if (missingSdkPackages.length > 0) reasons.push(`missing SDK main package(s): ${missingSdkPackages.join(', ')}`);
    throw new Error(`External CLI packaging verification failed: ${reasons.join('; ')}`);
  }
}

function main() {
  const explicitApps = process.argv.slice(2).map((targetPath) => path.resolve(targetPath));
  const appPaths = explicitApps.length > 0 ? explicitApps : collectAppBundles(distRoot);
  if (appPaths.length === 0) {
    throw new Error(`No .app bundles found under ${distRoot}`);
  }

  for (const appPath of appPaths) {
    if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
      throw new Error(`App bundle does not exist: ${appPath}`);
    }
    verifyApp(appPath);
  }

  console.log(`[external-cli-packaging] verified_apps=${appPaths.length}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
