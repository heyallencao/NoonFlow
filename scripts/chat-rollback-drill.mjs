#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const TEST_FILE = 'src/__tests__/unit/chat-rollback-drill.test.ts';

console.log('[chat-rollback-drill] Starting rollback drill...');
console.log(`[chat-rollback-drill] Test file: ${TEST_FILE}`);

const result = spawnSync(
  'npx',
  ['tsx', '--test', TEST_FILE],
  {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  },
);

if (result.stdout?.trim()) {
  console.log(result.stdout.trim());
}

if (result.stderr?.trim()) {
  console.error(result.stderr.trim());
}

if (result.status !== 0) {
  console.error('[chat-rollback-drill] Rollback drill failed.');
  process.exit(result.status ?? 1);
}

console.log('[chat-rollback-drill] Rollback drill passed.');
