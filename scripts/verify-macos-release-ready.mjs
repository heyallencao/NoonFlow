import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function hasDeveloperIdIdentity() {
  const result = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (result.status !== 0) {
    throw new Error(
      `Failed to inspect code signing identities.\n${result.stderr || result.stdout || ''}`.trim(),
    );
  }

  return /Developer ID Application:/.test(result.stdout);
}

function ensureSigningInputs() {
  const hasKeychainIdentity = hasDeveloperIdIdentity();
  const hasCSCLink = Boolean(process.env.CSC_LINK);

  if (!hasKeychainIdentity && !hasCSCLink) {
    throw new Error(
      [
        'Missing macOS code signing identity.',
        'Install a Developer ID Application certificate in the keychain, or provide CSC_LINK for electron-builder.',
      ].join('\n'),
    );
  }
}

function ensureNotarizationInputs() {
  const keychainProfile = process.env.APPLE_NOTARY_PROFILE;

  if (!keychainProfile) {
    throw new Error(
      [
        'Missing macOS notarization profile.',
        'Set APPLE_NOTARY_PROFILE to the keychain profile created by xcrun notarytool store-credentials.',
      ].join('\n'),
    );
  }

  const notarytool = run('xcrun', ['notarytool', '--version']);
  if (notarytool.status !== 0) {
    throw new Error(
      `xcrun notarytool is unavailable.\n${notarytool.stderr || notarytool.stdout || ''}`.trim(),
    );
  }
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('macOS release preflight skipped on non-darwin platform.');
    return;
  }

  ensureSigningInputs();
  ensureNotarizationInputs();

  console.log('macOS release preflight passed.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
