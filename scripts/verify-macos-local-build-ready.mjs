import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const electronDist = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const nvmrcPath = path.join(root, '.nvmrc');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function readExpectedNodeMajor() {
  if (!fs.existsSync(nvmrcPath)) {
    return null;
  }

  const raw = fs.readFileSync(nvmrcPath, 'utf8').trim();
  const match = raw.match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

function ensureNodeVersion() {
  const expectedMajor = readExpectedNodeMajor();
  if (!expectedMajor) {
    return;
  }

  if (Number(process.versions.node.split('.')[0]) !== expectedMajor) {
    fail(
      [
        `Expected Node ${expectedMajor}.x from .nvmrc, but found ${process.versions.node}.`,
        'Run `nvm use` in the project root before packaging.',
      ].join('\n'),
    );
  }
}

function ensureCommand(command, args, help) {
  const result = run(command, args);
  if (result.status !== 0) {
    fail([help, result.stderr || result.stdout || ''].filter(Boolean).join('\n'));
  }
}

function ensureElectronRuntime() {
  if (!fs.existsSync(electronDist)) {
    fail(
      [
        `Missing unpacked Electron runtime: ${electronDist}`,
        'Run `npm install` so electron-builder can reuse the local Electron.app instead of downloading from GitHub.',
      ].join('\n'),
    );
  }
}

function ensureDeveloperIdIdentity() {
  const result = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (result.status !== 0) {
    fail(`Failed to inspect code signing identities.\n${result.stderr || result.stdout || ''}`.trim());
  }

  if (!/Developer ID Application:/i.test(result.stdout)) {
    fail(
      [
        'Missing a usable Developer ID Application certificate in the login keychain.',
        'Import the certificate and private key before running local mac packaging.',
      ].join('\n'),
    );
  }
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Local mac packaging preflight skipped on non-darwin platform.');
    return;
  }

  ensureNodeVersion();
  ensureCommand('xcode-select', ['-p'], 'Xcode Command Line Tools are required for mac packaging.');
  ensureCommand('xcrun', ['-f', 'codesign'], 'codesign is unavailable on this machine.');
  ensureElectronRuntime();
  ensureDeveloperIdIdentity();

  console.log(
    [
      `macOS local packaging preflight passed.`,
      `Node ${process.versions.node}`,
      `Electron runtime ${electronDist}`,
    ].join(' '),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
