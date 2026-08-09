import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-claude-compact-'));
const claudeCliFixture = path.join(tmpDir, 'bin', 'claude');
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));
fs.mkdirSync(path.dirname(claudeCliFixture), { recursive: true });
fs.writeFileSync(claudeCliFixture, '#!/bin/sh\nexit 0\n');
fs.chmodSync(claudeCliFixture, 0o755);

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const claudeClient = require('../../lib/claude-client') as typeof import('../../lib/claude-client');
const claudeEnv = require('../../lib/claude-client/env') as typeof import('../../lib/claude-client/env');

const { closeDb } = db;
const { __setClaudeQueryForTests, streamClaude } = claudeClient;
const { __setClaudePathResolverForTests } = claudeEnv;

function parseSSEEvents(payload: string): Array<{ type: string; data: string }> {
  return payload
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string });
}

async function readStringStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let payload = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    payload += value;
  }
  return payload;
}

afterEach(() => {
  __setClaudeQueryForTests(null);
  __setClaudePathResolverForTests(null);
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('streamClaude official compact recovery', () => {
  it('runs official /compact and retries the original resumed turn after a context-limit resume failure', async () => {
    const calls: Array<{ prompt: string; resume?: string }> = [];
    const executablePaths: string[] = [];
    const recoverySnapshots: Array<import('../../types').ContextBudgetRecoveryMetrics> = [];
    let resumedPromptAttempts = 0;

    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests((input) => {
      const promptValue = typeof input.prompt === 'string' ? input.prompt : '[non-string-prompt]';
      const resume = input.options?.resume;
      calls.push({ prompt: promptValue, resume });
      if (input.options?.pathToClaudeCodeExecutable) {
        executablePaths.push(input.options.pathToClaudeCodeExecutable);
      }

      return (async function* () {
        if (resume === 'sdk-resume-1' && promptValue === 'Continue working') {
          resumedPromptAttempts += 1;
          if (resumedPromptAttempts === 1) {
            throw new Error('turn/start failed: Input exceeds the maximum length of 1048576 characters');
          }

          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-resume-1',
            model: 'claude-sonnet',
            tools: [],
          } as never;
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            },
          } as never;
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Recovered after compact' },
            },
          } as never;
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_stop',
              index: 0,
            },
          } as never;
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Recovered after compact' }],
            },
            parent_tool_use_id: null,
            uuid: 'assistant-1',
            session_id: 'sdk-resume-1',
          } as never;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 1,
            duration_ms: 42,
            usage: {
              input_tokens: 10,
              output_tokens: 12,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            total_cost_usd: 0.01,
            session_id: 'sdk-resume-1',
            result: 'Recovered after compact',
          } as never;
          return;
        }

        if (resume === 'sdk-resume-1' && promptValue === '/compact') {
          yield {
            type: 'system',
            subtype: 'status',
            status: 'compacting',
            permissionMode: 'acceptEdits',
            uuid: 'status-1',
            session_id: 'sdk-resume-1',
          } as never;
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: {
              trigger: 'manual',
              pre_tokens: 321,
            },
            uuid: 'compact-1',
            session_id: 'sdk-resume-1',
          } as never;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 1,
            duration_ms: 12,
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            total_cost_usd: 0,
            session_id: 'sdk-resume-1',
            result: '/compact completed',
          } as never;
          return;
        }

        throw new Error(`Unexpected query invocation: prompt=${promptValue}, resume=${resume ?? 'none'}`);
      })() as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const payload = await readStringStream(streamClaude({
      prompt: 'Continue working',
      sessionId: 'session-1',
      sdkSessionId: 'sdk-resume-1',
      onContextBudgetRecovery: async (metrics) => {
        recoverySnapshots.push(metrics);
      },
    }));

    const events = parseSSEEvents(payload);
    const statusEvents = events.filter((event) => event.type === 'status');
    const statusTexts = statusEvents.map((event) => event.data);

    assert.deepEqual(calls, [
      { prompt: 'Continue working', resume: 'sdk-resume-1' },
      { prompt: '/compact', resume: 'sdk-resume-1' },
      { prompt: 'Continue working', resume: 'sdk-resume-1' },
    ]);
    assert.equal(executablePaths.length, 3);
    assert.equal(executablePaths.every((executablePath) => path.isAbsolute(executablePath)), true);
    assert.equal(new Set(executablePaths).size, 1);
    assert.equal(executablePaths[0], claudeCliFixture);
    assert.ok(statusTexts.some((text) => text.includes('正在压缩上下文')));
    assert.ok(statusTexts.some((text) => text.includes('官方 /compact 已完成')));
    assert.ok(events.some((event) => event.type === 'text' && event.data === 'Recovered after compact'));
    assert.equal(events.some((event) => event.type === 'error'), false);

    const lastRecovery = recoverySnapshots.at(-1);
    assert.ok(lastRecovery);
    assert.equal(lastRecovery?.officialCompactAttempted, true);
    assert.equal(lastRecovery?.officialCompactSuccess, true);
    assert.equal(lastRecovery?.compactRetrySuccess, true);
    assert.equal(typeof lastRecovery?.recoveryDurationMs, 'number');
    assert.ok((lastRecovery?.recoveryDurationMs ?? -1) >= 0);
  });
});
