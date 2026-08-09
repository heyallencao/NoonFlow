import fs from 'node:fs';
import path from 'node:path';
import { listPackage } from '@electron/asar';

const workspaceRoot = process.cwd();
const explicitRoots = process.argv.slice(2).map((entry) => path.resolve(workspaceRoot, entry));

function normalizedPath(value) {
  return value.split(path.sep).join('/').toLowerCase();
}

function isForbiddenRuntime(value) {
  const normalized = normalizedPath(value);
  return /(^|\/)node_modules\/@openai\/codex-sdk(\/|$)/.test(normalized)
    || /(^|\/)@openai\/codex-(darwin|linux|win32)[^/]*(\/|$)/.test(normalized)
    || /(^|\/)@anthropic-ai\/claude-agent-sdk-(darwin|linux|win32)[^/]*(\/|$)/.test(normalized)
    || /(^|\/)node_modules\/\.bin\/(claude|codex)(\.cmd|\.exe)?$/.test(normalized)
    || /(^|\/)vendor\/[^/]*(claude|codex)[^/]*\/(claude|codex)(\.exe)?$/.test(normalized);
}

function defaultRoots() {
  const roots = [path.join(workspaceRoot, 'resources', 'standalone')];
  const distRoot = path.join(workspaceRoot, 'dist');
  if (!fs.existsSync(distRoot)) return roots;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name.endsWith('.app') || entry.name.endsWith('-unpacked')) {
        roots.push(absolute);
      } else {
        visit(absolute);
      }
    }
  };
  visit(distRoot);
  return roots;
}

function scanAsar(archivePath, findings) {
  for (const entry of listPackage(archivePath)) {
    if (isForbiddenRuntime(entry)) findings.push(`${archivePath}:${entry}`);
  }
}

function scanDirectory(scanRoot, findings) {
  const visit = (target) => {
    const stat = fs.lstatSync(target);
    if (isForbiddenRuntime(target)) findings.push(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      if (stat.isFile() && path.basename(target) === 'app.asar') scanAsar(target, findings);
      return;
    }
    for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
  };
  visit(scanRoot);
}

const roots = explicitRoots.length > 0 ? explicitRoots : defaultRoots();
const existingRoots = Array.from(new Set(roots.filter((entry) => fs.existsSync(entry))));
if (existingRoots.length === 0) {
  console.error('[runtime-scan] no staging or packaged application roots found');
  process.exit(2);
}

const findings = [];
for (const scanRoot of existingRoots) scanDirectory(scanRoot, findings);

if (findings.length > 0) {
  console.error(`[runtime-scan] forbidden bundled Claude/Codex runtimes found: ${findings.length}`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`[runtime-scan] roots=${existingRoots.length} forbidden=0`);
for (const scanRoot of existingRoots) console.log(`- ${scanRoot}`);
