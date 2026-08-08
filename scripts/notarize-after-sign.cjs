'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { notarize } = require('@electron/notarize');

function assertReleaseInputs() {
  const keychainProfile = process.env.APPLE_NOTARY_PROFILE;

  if (!keychainProfile) {
    throw new Error(
      [
        'macOS notarization is enabled but APPLE_NOTARY_PROFILE is missing.',
        'Create a notarization profile with `xcrun notarytool store-credentials` and export APPLE_NOTARY_PROFILE.',
      ].join('\n'),
    );
  }

  return { keychainProfile };
}

module.exports = async function notarizeAfterSign(context) {
  if (process.platform !== 'darwin') {
    return;
  }

  if ((process.env.NOONFLOW_NOTARIZE ?? process.env.MONOLITH_NOTARIZE) !== '1') {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    throw new Error(`Signed app bundle not found: ${appPath}`);
  }

  const { keychainProfile } = assertReleaseInputs();

  console.log(`[notarize] Notarizing ${appPath}`);
  await notarize({
    appPath,
    keychainProfile,
    tool: 'notarytool',
  });
  console.log('[notarize] Notarization completed');
};
