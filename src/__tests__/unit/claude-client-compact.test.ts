import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-claude-compact-'));
const claudeCliFixture = path.join(tmpDir, 'bin', 'claude');
const originalClaudeCompactionTimeoutMs = process.env.NOONFLOW_CLAUDE_COMPACTION_TIMEOUT_MS;
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
  if (originalClaudeCompactionTimeoutMs === undefined) {
    delete process.env.NOONFLOW_CLAUDE_COMPACTION_TIMEOUT_MS;
  } else {
    process.env.NOONFLOW_CLAUDE_COMPACTION_TIMEOUT_MS = originalClaudeCompactionTimeoutMs;
  }
  closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('streamClaude official compact recovery', () => {
  it('maps native task events to shared activity updates and does not wall-clock timeout a child agent', async () => {
    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests(() => {
      const mockedQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-child-1',
          model: 'claude-sonnet',
          tools: ['Task'],
        } as never;
        yield {
          type: 'system',
          subtype: 'task_started',
          task_id: 'child-1',
          tool_use_id: 'parent-tool-1',
          description: 'Inspect adapters',
          subagent_type: 'Explore',
          prompt: 'private child prompt',
          uuid: 'task-start-1',
          session_id: 'sdk-child-1',
        } as never;
        yield {
          type: 'tool_progress',
          tool_use_id: 'parent-tool-1',
          tool_name: 'Task',
          elapsed_time_seconds: 999,
          uuid: 'tool-progress-1',
          session_id: 'sdk-child-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'task_progress',
          task_id: 'child-1',
          tool_use_id: 'parent-tool-1',
          description: 'Inspect adapters',
          subagent_type: 'Explore',
          summary: 'Checked event flow',
          usage: { total_tokens: 20, tool_uses: 2, duration_ms: 999_000 },
          uuid: 'task-progress-1',
          session_id: 'sdk-child-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'child-1',
          tool_use_id: 'parent-tool-1',
          status: 'completed',
          output_file: '/tmp/child-output',
          summary: 'Done',
          uuid: 'task-done-1',
          session_id: 'sdk-child-1',
        } as never;
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          duration_ms: 1_000_000,
          usage: {
            input_tokens: 8,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          total_cost_usd: 0,
          session_id: 'sdk-child-1',
          result: 'done',
        } as never;
      })();
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const abortController = new AbortController();
    const payload = await readStringStream(streamClaude({
      prompt: 'delegate',
      sessionId: 'session-child-1',
      toolTimeoutSeconds: 30,
      abortController,
    }));
    const events = parseSSEEvents(payload);
    const activities = events
      .filter((event) => event.type === 'activity.updated')
      .map((event) => JSON.parse(event.data) as import('../../types').ChildActivity);

    assert.deepEqual(activities.map((activity) => activity.status), ['running', 'running', 'completed']);
    assert.ok(activities.every((activity) => activity.runtime === 'claude_code'));
    assert.equal(events.some((event) => event.type === 'tool_timeout'), false);
    assert.equal(abortController.signal.aborted, false);
    assert.equal(JSON.stringify(activities).includes('private child prompt'), false);
  });

  it('retains the configured wall-clock timeout for an ordinary top-level tool', async () => {
    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests(() => {
      const mockedQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'task_started',
          task_id: 'foreground-task-1',
          tool_use_id: 'ordinary-tool-1',
          task_type: 'bash',
          description: 'Run ordinary command',
          uuid: 'ordinary-task-start-1',
          session_id: 'sdk-ordinary-1',
        } as never;
        yield {
          type: 'tool_progress',
          tool_use_id: 'ordinary-tool-1',
          tool_name: 'Bash',
          task_id: 'foreground-task-1',
          elapsed_time_seconds: 31,
          uuid: 'ordinary-progress-1',
          session_id: 'sdk-ordinary-1',
        } as never;
      })();
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const abortController = new AbortController();
    const events = parseSSEEvents(await readStringStream(streamClaude({
      prompt: 'run an ordinary tool',
      sessionId: 'session-ordinary-1',
      toolTimeoutSeconds: 30,
      abortController,
    })));

    assert.equal(events.filter((event) => event.type === 'tool_timeout').length, 1);
    assert.equal(events.some((event) => event.type === 'activity.updated'), false);
    assert.equal(abortController.signal.aborted, true);
  });

  it('does not wall-clock timeout a background Bash task identified only by task_id', async () => {
    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests(() => {
      const mockedQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [{ task_id: 'background-bash-1', task_type: 'bash', description: 'Build preview' }],
          uuid: 'background-start-1',
          session_id: 'sdk-background-1',
        } as never;
        yield {
          type: 'tool_progress',
          tool_use_id: 'background-bash-tool-1',
          tool_name: 'Bash',
          task_id: 'background-bash-1',
          elapsed_time_seconds: 999,
          uuid: 'background-progress-1',
          session_id: 'sdk-background-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'background_tasks_changed',
          tasks: [],
          uuid: 'background-done-1',
          session_id: 'sdk-background-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'task_notification',
          task_id: 'background-bash-1',
          status: 'completed',
          output_file: '/tmp/background-bash-output',
          summary: 'Build complete',
          uuid: 'background-terminal-1',
          session_id: 'sdk-background-1',
        } as never;
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          duration_ms: 1_000_000,
          usage: {
            input_tokens: 8,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          total_cost_usd: 0,
          session_id: 'sdk-background-1',
          result: 'done',
        } as never;
      })();
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const abortController = new AbortController();
    const events = parseSSEEvents(await readStringStream(streamClaude({
      prompt: 'run a background build',
      sessionId: 'session-background-1',
      toolTimeoutSeconds: 30,
      abortController,
    })));

    assert.equal(events.some((event) => event.type === 'tool_timeout'), false);
    assert.equal(abortController.signal.aborted, false);
    assert.deepEqual(
      events
        .filter((event) => event.type === 'activity.updated')
        .map((event) => (JSON.parse(event.data) as import('../../types').ChildActivity).status),
      ['running', 'completed'],
    );
  });

  it('runs official /compact and retries the original resumed turn after a context-limit resume failure', async () => {
    const calls: Array<{ prompt: string; resume?: string }> = [];
    const executablePaths: string[] = [];
    const recoverySnapshots: Array<import('../../types').ContextBudgetRecoveryMetrics> = [];
    const nativeUsageCalls: string[] = [];
    let resumedPromptAttempts = 0;

    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests((input) => {
      const promptValue = typeof input.prompt === 'string' ? input.prompt : '[non-string-prompt]';
      const resume = input.options?.resume;
      calls.push({ prompt: promptValue, resume });
      if (input.options?.pathToClaudeCodeExecutable) {
        executablePaths.push(input.options.pathToClaudeCodeExecutable);
      }

      const mockedQuery = (async function* () {
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
            subtype: 'status',
            status: 'compacting',
            permissionMode: 'acceptEdits',
            uuid: 'status-2',
            session_id: 'sdk-resume-1',
          } as never;
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: {
              trigger: 'manual',
              pre_tokens: 321,
              post_tokens: 123,
              duration_ms: 12,
            },
            uuid: 'compact-1',
            session_id: 'sdk-resume-1',
          } as never;
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
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
            result: 'late result error after compact boundary',
          } as never;
          return;
        }

        throw new Error(`Unexpected query invocation: prompt=${promptValue}, resume=${resume ?? 'none'}`);
      })();
      Object.defineProperty(mockedQuery, 'getContextUsage', {
        value: async () => {
          nativeUsageCalls.push(promptValue);
          return {
            totalTokens: promptValue === '/compact' ? 123 : 140,
            maxTokens: 1_000,
            contextWindow: {
              systemPrompt: 10,
              systemTools: 10,
              mcpTools: 0,
              memoryFiles: 0,
              skills: 0,
              messages: promptValue === '/compact' ? 103 : 120,
              autocompactBuffer: 0,
            },
          };
        },
      });
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
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

    assert.deepEqual(nativeUsageCalls, ['/compact', 'Continue working', 'Continue working']);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('session-1');
    assert.equal(state?.source, 'native');
    assert.deepEqual(state?.currentContext, {
      usedTokens: 140,
      contextWindowTokens: 1_000,
      percentage: 14,
    });
    assert.deepEqual(state?.lastTurnUsage, {
      input_tokens: 10,
      output_tokens: 12,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cost_usd: 0.01,
    });
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.trigger, 'recovery');
    assert.equal(state?.compaction.preTokens, 321);
    assert.equal(state?.compaction.postTokens, 123);
    assert.equal(state?.compaction.postTokensEstimated, false);
    assert.equal(typeof state?.compaction.startedAt, 'number');
    assert.equal(typeof state?.compaction.completedAt, 'number');
    assert.equal(state?.compaction.error, null);
  });

  it('times out a compact stream that stops emitting and continues through the fresh-session fallback', { timeout: 1_000 }, async () => {
    process.env.NOONFLOW_CLAUDE_COMPACTION_TIMEOUT_MS = '30';
    const calls: Array<{ prompt: string; resume?: string }> = [];
    let compactCloseCalls = 0;

    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests((input) => {
      const promptValue = typeof input.prompt === 'string' ? input.prompt : '[non-string-prompt]';
      const resume = input.options?.resume;
      calls.push({ prompt: promptValue, resume });

      const mockedQuery = (async function* () {
        if (resume === 'sdk-hang-1' && promptValue === 'Continue after timeout') {
          throw new Error('Input exceeds the maximum length of 1048576 characters');
        }
        if (resume === 'sdk-hang-1' && promptValue === '/compact') {
          yield {
            type: 'system',
            subtype: 'status',
            status: 'compacting',
            uuid: 'compact-hang-status',
            session_id: 'sdk-hang-1',
          } as never;
          await new Promise<void>(() => {});
          return;
        }
        if (!resume && promptValue === 'Continue after timeout') {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-fresh-1',
            model: 'claude-sonnet',
            tools: [],
          } as never;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 1,
            duration_ms: 5,
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            total_cost_usd: 0,
            session_id: 'sdk-fresh-1',
            result: 'fresh fallback completed',
          } as never;
          return;
        }
        throw new Error(`Unexpected query invocation: prompt=${promptValue}, resume=${resume ?? 'none'}`);
      })();
      Object.defineProperty(mockedQuery, 'close', {
        value: () => {
          if (promptValue === '/compact') compactCloseCalls += 1;
        },
      });
      Object.defineProperty(mockedQuery, 'getContextUsage', {
        value: async () => ({
          totalTokens: 6,
          maxTokens: 1_000,
          contextWindow: {
            systemPrompt: 0,
            systemTools: 0,
            mcpTools: 0,
            memoryFiles: 0,
            skills: 0,
            messages: 6,
            autocompactBuffer: 0,
          },
        }),
      });
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const payload = await readStringStream(streamClaude({
      prompt: 'Continue after timeout',
      sessionId: 'session-compact-hang',
      sdkSessionId: 'sdk-hang-1',
    }));

    assert.deepEqual(calls, [
      { prompt: 'Continue after timeout', resume: 'sdk-hang-1' },
      { prompt: '/compact', resume: 'sdk-hang-1' },
      { prompt: 'Continue after timeout', resume: undefined },
    ]);
    assert.equal(compactCloseCalls, 1);
    assert.match(payload, /Session fallback/);
    assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('session-compact-hang');
    assert.equal(state?.compaction.status, 'failed');
    assert.match(state?.compaction.error ?? '', /timed out after 30ms/);
    assert.equal(state?.compaction.postTokens, null);
  });

  it('keeps compact_boundary authoritative and invalidates stale usage when refresh fails', async () => {
    let usageCalls = 0;
    __setClaudePathResolverForTests(() => claudeCliFixture);
    __setClaudeQueryForTests(() => {
      const mockedQuery = (async function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-auto-1',
          model: 'claude-sonnet',
          tools: [],
        } as never;
        yield {
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          uuid: 'auto-status-1',
          session_id: 'sdk-auto-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          uuid: 'auto-status-2',
          session_id: 'sdk-auto-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: {
            trigger: 'auto',
            pre_tokens: 800,
            post_tokens: 100,
            duration_ms: 25,
          },
          uuid: 'auto-boundary-1',
          session_id: 'sdk-auto-1',
        } as never;
        yield {
          type: 'system',
          subtype: 'status',
          status: null,
          compact_result: 'failed',
          compact_error: 'late failure after boundary',
          uuid: 'auto-status-3',
          session_id: 'sdk-auto-1',
        } as never;
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          num_turns: 1,
          duration_ms: 20,
          usage: {
            input_tokens: 8,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          total_cost_usd: 0,
          session_id: 'sdk-auto-1',
          result: 'done',
        } as never;
      })();
      Object.defineProperty(mockedQuery, 'getContextUsage', {
        value: async () => {
          usageCalls += 1;
          if (usageCalls > 1) throw new Error('native usage refresh failed');
          return {
            totalTokens: 800,
            maxTokens: 1_000,
            contextWindow: {
              systemPrompt: 0,
              systemTools: 0,
              mcpTools: 0,
              memoryFiles: 0,
              skills: 0,
              messages: 800,
              autocompactBuffer: 0,
            },
          };
        },
      });
      return mockedQuery as ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').query>;
    });

    const payload = await readStringStream(streamClaude({
      prompt: 'auto compact',
      sessionId: 'session-auto',
    }));
    assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);

    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('session-auto');
    assert.equal(state?.source, 'unavailable');
    assert.equal(state?.currentContext, null);
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.trigger, 'auto');
    assert.equal(state?.compaction.preTokens, 800);
    assert.equal(state?.compaction.postTokens, 100);
    assert.equal(state?.compaction.postTokensEstimated, false);
    assert.equal(state?.compaction.error, null);
    assert.ok((state?.compaction.startedAt ?? Infinity) <= (state?.compaction.completedAt ?? -Infinity));
  });
});
