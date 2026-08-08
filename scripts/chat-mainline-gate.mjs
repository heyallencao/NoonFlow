#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const CHAT_SPEC = 'src/__tests__/e2e/chat.spec.ts';
const TEST_TITLES = [
  'successful completion renders only one assistant message',
  'focus resync after done keeps the same assistant visible until persisted ack lands',
  'visibilitychange resync after done keeps the same assistant visible until persisted ack lands',
  'switching to another session and back keeps a single assistant after remount',
  'hard reload keeps a single persisted user and assistant while server persistence catches up',
  'online reconnect resync retries until the persisted assistant converges without duplicates',
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

function summarizeSpecRuns(specs) {
  const counts = new Map();
  for (const spec of specs) {
    const title = spec.title;
    const current = counts.get(title) ?? {
      passed: 0,
      failed: 0,
      skipped: 0,
      interrupted: 0,
      timedOut: 0,
      other: 0,
    };

    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        switch (result.status) {
          case 'passed':
            current.passed += 1;
            break;
          case 'failed':
            current.failed += 1;
            break;
          case 'skipped':
            current.skipped += 1;
            break;
          case 'interrupted':
            current.interrupted += 1;
            break;
          case 'timedOut':
            current.timedOut += 1;
            break;
          default:
            current.other += 1;
            break;
        }
      }
    }

    counts.set(title, current);
  }

  return counts;
}

const repeatEach = parsePositiveInt(process.env.MONOLITH_CHAT_MAINLINE_REPEAT, 17);
const workers = parsePositiveInt(process.env.MONOLITH_CHAT_MAINLINE_WORKERS, 2);
const minimumRuns = parsePositiveInt(process.env.MONOLITH_CHAT_MAINLINE_MIN_RUNS, 100);
const grepPattern = TEST_TITLES.map((title) => escapeRegex(title)).join('|');
const plannedRuns = TEST_TITLES.length * repeatEach;

if (plannedRuns < minimumRuns) {
  console.error(
    `[chat-mainline-gate] Planned runs ${plannedRuns} is below required minimum ${minimumRuns}. ` +
    `Increase MONOLITH_CHAT_MAINLINE_REPEAT.`,
  );
  process.exit(1);
}

console.log('[chat-mainline-gate] Starting Playwright gate...');
console.log(`[chat-mainline-gate] Spec: ${CHAT_SPEC}`);
console.log(`[chat-mainline-gate] Tests: ${TEST_TITLES.length}`);
console.log(`[chat-mainline-gate] Repeat each: ${repeatEach}`);
console.log(`[chat-mainline-gate] Planned runs: ${plannedRuns}`);
console.log(`[chat-mainline-gate] Workers: ${workers}`);

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
  console.error('[chat-mainline-gate] Failed to launch Playwright.');
  console.error(result.error);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch (error) {
  console.error('[chat-mainline-gate] Failed to parse Playwright JSON reporter output.');
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
const summary = summarizeSpecRuns(specs);
const stats = report.stats ?? {};
const executedRuns = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0) + (stats.skipped ?? 0);

console.log('[chat-mainline-gate] Summary:');
for (const title of TEST_TITLES) {
  const counts = summary.get(title) ?? {
    passed: 0,
    failed: 0,
    skipped: 0,
    interrupted: 0,
    timedOut: 0,
    other: 0,
  };
  console.log(
    `  - ${title}: passed=${counts.passed} failed=${counts.failed} ` +
    `skipped=${counts.skipped} interrupted=${counts.interrupted} timedOut=${counts.timedOut} other=${counts.other}`,
  );
}

console.log(
  `[chat-mainline-gate] Totals: expected=${stats.expected ?? 0} unexpected=${stats.unexpected ?? 0} ` +
  `flaky=${stats.flaky ?? 0} skipped=${stats.skipped ?? 0} executed=${executedRuns} duration_ms=${stats.duration ?? 0}`,
);

if (result.stderr?.trim()) {
  console.error('[chat-mainline-gate] Playwright stderr:');
  console.error(result.stderr.trim());
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (executedRuns < minimumRuns) {
  console.error(
    `[chat-mainline-gate] Executed runs ${executedRuns} is below required minimum ${minimumRuns}.`,
  );
  process.exit(1);
}

