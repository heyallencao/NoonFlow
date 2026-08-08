import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-runtime-stats-'));
const CODEX_DIR = path.join(TEST_HOME, '.codex');
const STATE_DB_PATH = path.join(CODEX_DIR, 'state_1.sqlite');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions', '2026', '04', '04');
const ARCHIVED_DIR = path.join(CODEX_DIR, 'archived_sessions');
const runtimeStatsPath = path.resolve(__dirname, '../../lib/runtime-stats.ts');
const originalHome = process.env.HOME;

type RuntimeStatsModule = typeof import('../../lib/runtime-stats');

function writeRollout(filePath: string, lines: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

function createStateDb(): Database.Database {
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  const db = new Database(STATE_DB_PATH);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model_provider TEXT NOT NULL DEFAULT '',
      model TEXT,
      cwd TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      tokens_used INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

function isoAtOffset(daysOffset: number, minutesOffset: number = 0): string {
  return new Date(Date.now() + (daysOffset * 24 * 60 * 60 * 1000) + (minutesOffset * 60 * 1000)).toISOString();
}

describe('runtime-stats codex ingestion', () => {
  let runtimeStats: RuntimeStatsModule;

  before(async () => {
    process.env.HOME = TEST_HOME;

    const db = createStateDb();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const staleUsageTimestamp = isoAtOffset(-10);
    const recentSessionTimestamp = isoAtOffset(0, -5);
    const archivedTimestamp = isoAtOffset(-10, 10);

    const threadedSessionId = '11111111-1111-4111-8111-111111111111';
    const threadedRolloutPath = path.join(
      SESSIONS_DIR,
      `rollout-2026-04-04T03-00-00-${threadedSessionId}.jsonl`
    );
    writeRollout(threadedRolloutPath, [
      {
        timestamp: staleUsageTimestamp,
        type: 'session_meta',
        payload: {
          id: threadedSessionId,
          timestamp: staleUsageTimestamp,
          cwd: '/tmp/threaded',
          model_provider: 'openai',
          model: 'gpt-5.4',
        },
      },
      {
        timestamp: staleUsageTimestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ text: 'Run a command' }],
        },
      },
      {
        timestamp: staleUsageTimestamp,
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
          call_id: 'call_exec',
        },
      },
      {
        timestamp: staleUsageTimestamp,
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_exec',
          output: 'Process exited with code 0',
        },
      },
      {
        timestamp: staleUsageTimestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 30,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 175,
            },
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 30,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 175,
            },
          },
        },
      },
      {
        timestamp: recentSessionTimestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ text: 'Recent follow-up' }],
        },
      },
    ]);

    db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        model_provider,
        model,
        cwd,
        title,
        tokens_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadedSessionId,
      threadedRolloutPath,
      nowSeconds - 10,
      nowSeconds - 1,
      'openai',
      'gpt-5.4',
      '/tmp/threaded',
      'Threaded session',
      175,
    );

    const threadOnlySessionId = '22222222-2222-4222-8222-222222222222';
    db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        model_provider,
        model,
        cwd,
        title,
        tokens_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadOnlySessionId,
      path.join(SESSIONS_DIR, `rollout-2026-04-04T03-10-00-${threadOnlySessionId}.jsonl`),
      nowSeconds - 20,
      nowSeconds - 2,
      'openai',
      'gpt-5.4',
      '/tmp/thread-only',
      'Thread-only session',
      300,
    );

    db.close();

    const archivedOnlySessionId = '33333333-3333-4333-8333-333333333333';
    writeRollout(
      path.join(ARCHIVED_DIR, `rollout-2026-04-04T03-20-00-${archivedOnlySessionId}.jsonl`),
      [
        {
          timestamp: archivedTimestamp,
          type: 'session_meta',
          payload: {
            id: archivedOnlySessionId,
            timestamp: archivedTimestamp,
            cwd: '/tmp/archived-only',
            model_provider: 'openai',
            model: 'gpt-5.4',
          },
        },
        {
          timestamp: archivedTimestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'apply_patch',
            input: '*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch',
            call_id: 'call_patch',
          },
        },
        {
          timestamp: archivedTimestamp,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call_patch',
            output: 'Success',
          },
        },
      ]
    );

    runtimeStats = await import(`${runtimeStatsPath}?runtime-stats-test=${Date.now()}`);
  });

  after(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
  });

  it('combines rollout scanning with state-db token fallbacks for Codex stats', () => {
    const usageStats = runtimeStats.getRuntimeTokenUsageStats(30);
    const toolsStats = runtimeStats.getRuntimeToolsStats(30);

    assert.equal(usageStats.summary.total_sessions, 2);
    assert.equal(
      usageStats.summary.total_input_tokens
      + usageStats.summary.total_output_tokens
      + usageStats.summary.cache_read_tokens
      + usageStats.summary.cache_creation_tokens,
      475,
    );
    assert.equal(usageStats.summary.total_output_tokens, 61);
    assert.equal(toolsStats.summary.totalToolCalls, 2);
    assert.equal(toolsStats.summary.distinctTools, 2);
    assert.equal(toolsStats.summary.totalFilesTouched, 1);
    assert.deepEqual(
      toolsStats.byTool.map((item) => item.toolName).sort(),
      ['Bash', 'Edit'],
    );
    assert.equal(toolsStats.topFiles[0]?.path, 'src/example.ts');
  });

  it('limits session token and cost totals to usage inside the selected time window', () => {
    const stats = runtimeStats.getRuntimeSessionsStats(1);

    assert.equal(stats.summary.totalSessions, 2);
    assert.equal(stats.summary.totalTokens, 300);
    assert.equal(stats.byRuntime.length, 1);
    assert.equal(stats.byRuntime[0]?.runtime, 'codex');
    assert.equal(stats.byRuntime[0]?.count, 2);
    assert.equal(stats.byRuntime[0]?.tokens, 300);
  });
});
