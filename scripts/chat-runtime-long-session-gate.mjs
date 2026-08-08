#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const CHAT_SPEC = 'src/__tests__/e2e/chat.spec.ts';
const TEST_TITLES = [
  'Codex long session sends runtime payload and keeps a single assistant message',
  'Claude Code long session sends runtime payload and keeps a single assistant message',
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkSuites(suites, collector) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      collector.push(spec);
    }
    walkSuites(suite.suites, collector);
  }
}

const repeatEach = parsePositiveInt(process.env.MONOLITH_CHAT_RUNTIME_LONG_REPEAT, 20);
const workers = parsePositiveInt(process.env.MONOLITH_CHAT_RUNTIME_LONG_WORKERS, 2);
const minimumRuns = parsePositiveInt(process.env.MONOLITH_CHAT_RUNTIME_LONG_MIN_RUNS, 40);
const grepPattern = TEST_TITLES.map((title) => escapeRegex(title)).join('|');
const plannedRuns = TEST_TITLES.length * repeatEach;

if (plannedRuns < minimumRuns) {
  console.error(
    `[chat-runtime-long-session-gate] Planned runs ${plannedRuns} is below required minimum ${minimumRuns}.`,
  );
  process.exit(1);
}

console.log('[chat-runtime-long-session-gate] Starting Playwright gate...');
console.log(`[chat-runtime-long-session-gate] Spec: ${CHAT_SPEC}`);
console.log(`[chat-runtime-long-session-gate] Tests: ${TEST_TITLES.length}`);
console.log(`[chat-runtime-long-session-gate] Repeat each: ${repeatEach}`);
console.log(`[chat-runtime-long-session-gate] Planned runs: ${plannedRuns}`);
console.log(`[chat-runtime-long-session-gate] Workers: ${workers}`);

const result = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    CHAT_SPEC,
    `--workers=${workers}`,
    `--repeat-each=${repeatEach}`,
    '--reporter=json',
    '-g',
    grepPattern,
  ],
  {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  },
);

if (result.error) {
  console.error('[chat-runtime-long-session-gate] Failed to launch Playwright.');
  console.error(result.error);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (error) {
  console.error('[chat-runtime-long-session-gate] Failed to parse Playwright JSON reporter output.');
  console.error(error);
  if (result.stdout) {
    console.error(result.stdout.slice(0, 4000));
  }
  if (result.stderr) {
    console.error(result.stderr.slice(0, 4000));
  }
  process.exit(1);
}

const specs = [];
walkSuites(report.suites, specs);
const stats = report.stats ?? {};
const executedRuns = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0);

console.log('[chat-runtime-long-session-gate] Summary:');
for (const title of TEST_TITLES) {
  let passed = 0;
  let failed = 0;
  for (const spec of specs) {
    if (spec.title !== title) {
      continue;
    }
    for (const test of spec.tests ?? []) {
      for (const run of test.results ?? []) {
        if (run.status === 'passed') {
          passed += 1;
        } else if (run.status === 'failed') {
          failed += 1;
        }
      }
    }
  }
  console.log(`  - ${title}: passed=${passed} failed=${failed}`);
}

console.log(
  `[chat-runtime-long-session-gate] Totals: expected=${stats.expected ?? 0} unexpected=${stats.unexpected ?? 0} ` +
  `flaky=${stats.flaky ?? 0} skipped=${stats.skipped ?? 0} executed=${executedRuns} duration_ms=${stats.duration ?? 0}`,
);

if (result.stderr?.trim()) {
  console.error('[chat-runtime-long-session-gate] Playwright stderr:');
  console.error(result.stderr.trim());
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (executedRuns < minimumRuns) {
  console.error(
    `[chat-runtime-long-session-gate] Executed runs ${executedRuns} is below required minimum ${minimumRuns}.`,
  );
  process.exit(1);
}
