'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result;
}

function fileType(filePath) {
  const result = spawnSync('file', ['-b', filePath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

function isMachO(filePath) {
  return /Mach-O/i.test(fileType(filePath));
}

function walk(dir, visitor) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      visitor(abs, false, true);
      continue;
    }
    if (entry.isDirectory()) {
      visitor(abs, true, false);
      walk(abs, visitor);
    } else {
      visitor(abs, false, false);
    }
  }
}

function walkSymlinks(dir, visitor) {
  walk(dir, (abs, _isDir, isSymlink) => {
    if (isSymlink) {
      visitor(abs);
    }
  });
}

function findEnclosingBundleRoot(targetPath) {
  let current = path.dirname(targetPath);
  while (current !== path.dirname(current)) {
    if (current.endsWith('.framework') || current.endsWith('.app')) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

function normalizeAbsoluteSymlink(linkPath) {
  const linkTarget = fs.readlinkSync(linkPath);
  if (!path.isAbsolute(linkTarget)) {
    return false;
  }

  const bundleRoot = findEnclosingBundleRoot(linkPath);
  if (!bundleRoot) {
    return false;
  }

  const bundleName = path.basename(bundleRoot);
  const marker = `${path.sep}${bundleName}${path.sep}`;
  const markerIndex = linkTarget.lastIndexOf(marker);
  if (markerIndex === -1) {
    return false;
  }

  const bundleRelativeTarget = linkTarget.slice(markerIndex + marker.length);
  if (!bundleRelativeTarget) {
    return false;
  }

  const normalizedTarget = path.join(bundleRoot, bundleRelativeTarget);
  const bundlePrefix = `${bundleRoot}${path.sep}`;
  if (normalizedTarget !== bundleRoot && !normalizedTarget.startsWith(bundlePrefix)) {
    return false;
  }

  fs.unlinkSync(linkPath);
  fs.symlinkSync(path.relative(path.dirname(linkPath), normalizedTarget), linkPath);
  return true;
}

function normalizeBundleSymlinks(appPath) {
  let rewrites = 0;

  walkSymlinks(appPath, (linkPath) => {
    if (normalizeAbsoluteSymlink(linkPath)) {
      rewrites += 1;
    }
  });

  if (rewrites > 0) {
    console.log(`[mac-sign] Rewrote ${rewrites} absolute bundle symlink(s) before signing.`);
  }
}

function collectBundles(appPath) {
  const bundles = [];
  walk(appPath, (abs, isDir) => {
    if (!isDir) {
      return;
    }
    if (abs.endsWith('.app') || abs.endsWith('.framework')) {
      bundles.push(abs);
    }
  });
  return bundles.sort((a, b) => b.length - a.length);
}

function collectMachOs(appPath) {
  const files = [];
  walk(appPath, (abs, isDir) => {
    if (!isDir && isMachO(abs)) {
      files.push(abs);
    }
  });
  return files.sort();
}

function sign(identity, target, signOptions = {}) {
  const removeSignature = spawnSync('codesign', ['--remove-signature', target], { encoding: 'utf8' });
  if (removeSignature.error) {
    throw removeSignature.error;
  }
  if (removeSignature.status !== 0 && !/code object is not signed/i.test(removeSignature.stderr || '')) {
    throw new Error(
      [
        `codesign --remove-signature ${target} failed with exit code ${removeSignature.status}`,
        removeSignature.stdout,
        removeSignature.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const args = ['--force', '--sign', identity];

  if (signOptions.timestamp !== false) {
    args.push('--timestamp');
  }

  if (signOptions.hardenedRuntime !== false) {
    args.push('--options', 'runtime');
  }

  if (signOptions.requirements) {
    args.push('--requirements', signOptions.requirements);
  }

  if (signOptions.entitlements) {
    args.push('--entitlements', signOptions.entitlements);
  }

  if (Array.isArray(signOptions.additionalArguments) && signOptions.additionalArguments.length > 0) {
    args.push(...signOptions.additionalArguments);
  }

  args.push(target);
  run('codesign', args);
}

module.exports = async function customMacSign(opts, packager) {
  const identity =
    typeof opts.identity === 'string'
      ? opts.identity
      : opts.identity?.name ||
        opts.identity?.hash ||
        opts.identityName ||
        opts.identityHash ||
        null;

  if (!identity) {
    throw new Error('Missing mac signing identity');
  }

  const appPath =
    opts.app ||
    (packager
      ? path.join(opts.appOutDir || path.dirname(opts.app), `${packager.appInfo.productFilename}.app`)
      : null);

  if (!appPath || !fs.existsSync(appPath)) {
    throw new Error(`App bundle not found for custom mac signing: ${appPath ?? 'unknown path'}`);
  }

  normalizeBundleSymlinks(appPath);

  const appEntitlements = opts.entitlements || null;
  const inheritEntitlements = opts.entitlementsInherit || opts['entitlements-inherit'] || appEntitlements;
  const optionsForFile =
    typeof opts.optionsForFile === 'function'
      ? opts.optionsForFile
      : (filePath) => ({
          entitlements: filePath === appPath ? appEntitlements : inheritEntitlements,
          hardenedRuntime: true,
          timestamp: true,
        });

  const machOs = collectMachOs(appPath)
    .filter(file => !file.includes('/Contents/_CodeSignature/'))
    .sort((a, b) => b.length - a.length);

  for (const file of machOs) {
    sign(identity, file, optionsForFile(file));
  }

  const bundles = collectBundles(appPath).filter(bundle => bundle !== appPath);
  for (const bundle of bundles) {
    sign(identity, bundle, optionsForFile(bundle));
  }

  sign(identity, appPath, optionsForFile(appPath));
};
