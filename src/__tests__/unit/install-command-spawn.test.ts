import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodePackageManagerAction, shouldUseWindowsCommandShell } from '../../../electron/lib/command-spawn';

describe('install command spawning', () => {
  it('uses a command shell for Windows npm wrappers', () => {
    assert.equal(shouldUseWindowsCommandShell('npm.cmd', 'win32'), true);
    assert.equal(shouldUseWindowsCommandShell('npm.bat', 'win32'), true);
  });

  it('does not introduce a shell for native executables or non-Windows commands', () => {
    assert.equal(shouldUseWindowsCommandShell('winget.exe', 'win32'), false);
    assert.equal(shouldUseWindowsCommandShell('npm', 'darwin'), false);
    assert.equal(shouldUseWindowsCommandShell('/opt/homebrew/bin/brew', 'darwin'), false);
  });

  it('upgrades package-manager Node installations instead of reinstalling them', () => {
    assert.equal(nodePackageManagerAction(false), 'install');
    assert.equal(nodePackageManagerAction(true), 'upgrade');
  });
});
