/**
 * Unit tests for file API path traversal security fixes.
 *
 * Run with: npx tsx src/__tests__/unit/files-security.test.ts
 *
 * Tests verify that:
 * 1. isPathSafe correctly prevents path traversal attacks
 * 2. Paths outside the base directory are rejected
 * 3. Symlink-based escapes are caught
 * 4. Edge cases (root, same path, trailing separators) are handled
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Import the function under test
import { isPathSafe } from '../../lib/files';

describe('isPathSafe', () => {
  it('should allow paths within the base directory', () => {
    assert.equal(isPathSafe('/home/user/project', '/home/user/project/src/index.ts'), true);
    assert.equal(isPathSafe('/home/user/project', '/home/user/project/package.json'), true);
    assert.equal(isPathSafe('/home/user/project', '/home/user/project/src/lib/utils.ts'), true);
  });

  it('should allow the base directory itself', () => {
    assert.equal(isPathSafe('/home/user/project', '/home/user/project'), true);
  });

  it('should reject paths outside the base directory', () => {
    assert.equal(isPathSafe('/home/user/project', '/home/user/other'), false);
    assert.equal(isPathSafe('/home/user/project', '/home/user'), false);
    assert.equal(isPathSafe('/home/user/project', '/etc/passwd'), false);
    assert.equal(isPathSafe('/home/user/project', '/tmp/malicious'), false);
  });

  it('should reject path traversal via ../', () => {
    // path.resolve will normalize these, but the resolved path should be outside base
    const base = '/home/user/project';
    const traversal = path.resolve(base, '../../etc/passwd');
    assert.equal(isPathSafe(base, traversal), false);
  });

  it('should reject directory names that are prefixes but not parents', () => {
    // /home/user/project-evil should NOT be allowed under /home/user/project
    assert.equal(isPathSafe('/home/user/project', '/home/user/project-evil/file.txt'), false);
    assert.equal(isPathSafe('/home/user/project', '/home/user/projectx'), false);
  });

  it('should handle Windows-style paths if on Windows', () => {
    if (process.platform === 'win32') {
      assert.equal(isPathSafe('C:\\Users\\user\\project', 'C:\\Users\\user\\project\\src\\index.ts'), true);
      assert.equal(isPathSafe('C:\\Users\\user\\project', 'D:\\other\\file.txt'), false);
    }
  });
});

describe('File API path traversal scenarios', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-test-'));
  const projectDir = path.join(tmpDir, 'myproject');
  const secretFile = path.join(tmpDir, 'secret.txt');

  // Setup test fixtures
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'index.ts'), 'console.log("hello");\n');
  fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'export default {};\n');
  fs.writeFileSync(secretFile, 'TOP SECRET DATA\n');

  it('should allow reading files inside the project', () => {
    const filePath = path.join(projectDir, 'index.ts');
    assert.equal(isPathSafe(projectDir, filePath), true);
  });

  it('should allow reading files in subdirectories', () => {
    const filePath = path.join(projectDir, 'src', 'app.ts');
    assert.equal(isPathSafe(projectDir, filePath), true);
  });

  it('should block reading files outside the project via relative path', () => {
    const maliciousPath = path.resolve(projectDir, '..', 'secret.txt');
    assert.equal(isPathSafe(projectDir, maliciousPath), false);
    // Verify the secret file actually exists (test is meaningful)
    assert.equal(fs.existsSync(maliciousPath), true);
  });

  it('should block reading system files', () => {
    assert.equal(isPathSafe(projectDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(projectDir, '/etc/shadow'), false);
  });

  it('should block reading via encoded traversal after resolution', () => {
    // Even if someone tries URL-encoded ../, path.resolve normalizes it
    const resolved = path.resolve(projectDir, '..', '..', 'etc', 'passwd');
    assert.equal(isPathSafe(projectDir, resolved), false);
  });

  // Symlink test (only on Unix-like systems)
  if (process.platform !== 'win32') {
    it('should block symlink escape from project directory', () => {
      const symlinkPath = path.join(projectDir, 'escape-link');
      try {
        fs.symlinkSync('/etc', symlinkPath);
        const resolvedSymlink = fs.realpathSync(path.join(symlinkPath, 'passwd'));
        assert.equal(isPathSafe(projectDir, resolvedSymlink), false);
      } finally {
        try { fs.unlinkSync(symlinkPath); } catch { /* cleanup */ }
      }
    });
  }

  // Cleanup test fixtures
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('baseDir validation', () => {
  it('should reject baseDir set to root (bypass attempt)', () => {
    // If baseDir=/, every path would pass isPathSafe — must be blocked
    const homeDir = os.homedir();
    assert.equal(isPathSafe(homeDir, '/'), false);
  });

  it('should reject baseDir outside home directory', () => {
    const homeDir = os.homedir();
    assert.equal(isPathSafe(homeDir, '/tmp'), false);
    assert.equal(isPathSafe(homeDir, '/etc'), false);
    assert.equal(isPathSafe(homeDir, '/var/log'), false);
  });

  it('should allow baseDir inside home directory', () => {
    const homeDir = os.homedir();
    const projectDir = path.join(homeDir, 'projects', 'myapp');
    assert.equal(isPathSafe(homeDir, projectDir), true);
  });

  it('should allow baseDir equal to home directory', () => {
    const homeDir = os.homedir();
    assert.equal(isPathSafe(homeDir, homeDir), true);
  });

  it('should block files outside home when no baseDir provided (fallback)', () => {
    const homeDir = os.homedir();
    assert.equal(isPathSafe(homeDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(homeDir, '/tmp/malicious'), false);
  });

  it('should allow files inside home when no baseDir provided (fallback)', () => {
    const homeDir = os.homedir();
    const filePath = path.join(homeDir, 'documents', 'file.txt');
    assert.equal(isPathSafe(homeDir, filePath), true);
  });
});
