import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const runFullSuite = process.argv.includes('--full');
const unitTestsDir = path.resolve('src/__tests__/unit');
const excludedStableTests = new Set([
  'claude-session-parser.test.ts',
  'codex-session-parser.test.ts',
  'worktree-limit-cleanup.test.ts',
]);

function collectTestFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = collectTestFiles(unitTestsDir)
  .filter((filePath) => runFullSuite || !excludedStableTests.has(path.basename(filePath)))
  .sort();

if (testFiles.length === 0) {
  console.error('[run-unit-tests] No test files matched.');
  process.exit(1);
}

const result = spawnSync('npx', ['tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
