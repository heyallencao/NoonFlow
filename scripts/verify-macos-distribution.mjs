import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const distRoot = path.join(root, 'dist');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function collectAppBundles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const appBundles = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      appBundles.push(abs);
      continue;
    }

    if (entry.isDirectory()) {
      appBundles.push(...collectAppBundles(abs));
    }
  }

  return appBundles;
}

function collectFrameworkBundles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const frameworkBundles = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.framework')) {
      frameworkBundles.push(abs);
      continue;
    }

    if (entry.isDirectory()) {
      frameworkBundles.push(...collectFrameworkBundles(abs));
    }
  }

  return frameworkBundles;
}

function pickNewest(paths) {
  return [...paths].sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function verifyBundleSignature(targetPath) {
  const verify = run('codesign', ['--verify', '--verbose=2', targetPath]);
  if (verify.status !== 0) {
    throw new Error(`codesign verification failed for ${targetPath}\n${verify.stderr || verify.stdout || ''}`.trim());
  }
}

function ensureSignedBundle(appPath) {
  const nestedTargets = [
    ...collectFrameworkBundles(appPath),
    ...collectAppBundles(appPath).filter((bundle) => bundle !== appPath),
  ].sort((a, b) => b.length - a.length);

  for (const targetPath of nestedTargets) {
    verifyBundleSignature(targetPath);
  }

  verifyBundleSignature(appPath);
  const details = run('codesign', ['-dv', '--verbose=4', appPath]);
  const output = `${details.stdout}\n${details.stderr}`;

  if (!/Authority=Developer ID Application:/i.test(output)) {
    throw new Error(
      [
        `App bundle is signed, but not with a Developer ID Application certificate: ${appPath}`,
        output.trim(),
      ].join('\n'),
    );
  }

  return output;
}

function assessGatekeeper(appPath) {
  const result = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  const output = `${result.stdout}\n${result.stderr}`.trim();

  if (result.status === 0) {
    return { status: 'accepted', details: output };
  }

  const looksLikeExpectedUnnotarizedPrompt =
    /source=Unnotarized Developer ID/i.test(output) ||
    (/origin=Developer ID Application:/i.test(output) && /rejected/i.test(output));

  if (looksLikeExpectedUnnotarizedPrompt) {
    return { status: 'accepted-with-warning', details: output };
  }

  throw new Error(
    [
      `Gatekeeper assessment failed in an unexpected way for ${appPath}`,
      output,
    ].join('\n'),
  );
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('macOS distribution verification skipped on non-darwin platform.');
    return;
  }

  const bundles = collectAppBundles(distRoot);
  if (bundles.length === 0) {
    throw new Error(`No .app bundle found under ${distRoot}`);
  }

  const appPath = pickNewest(bundles);
  const signOutput = ensureSignedBundle(appPath);
  const gatekeeper = assessGatekeeper(appPath);

  console.log(`Verified app bundle: ${appPath}`);
  console.log(
    gatekeeper.status === 'accepted'
      ? 'Gatekeeper accepted the app bundle.'
      : 'Gatekeeper reports an expected unnotarized Developer ID warning, not a damaged bundle.',
  );
  console.log(signOutput.trim());
  if (gatekeeper.details) {
    console.log(gatekeeper.details);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
