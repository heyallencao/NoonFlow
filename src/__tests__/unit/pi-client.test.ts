import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseWindowsPiShimScript, piClientPlatform, resolveWindowsPiNodeCommand, streamPi } from '../../lib/pi-client';
import { getRuntimeContextState } from '../../lib/context-runtime';
import { composePiModelSelection, splitPiModelSelection } from '../../lib/pi-model-selection';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-rpc-'));
const fakePiPath = path.join(testDir, 'fake-pi.cjs');
const capturePath = path.join(testDir, 'capture.json');
const originalFind = piClientPlatform.findPiBinary;
const originalSpawn = piClientPlatform.spawn;
const originalDangerousPermissions = piClientPlatform.dangerouslySkipPermissionsEnabled;
let fakeScenario = 'normal';

async function readStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) return chunks.join('');
    chunks.push(value);
  }
}

before(() => {
  fs.writeFileSync(fakePiPath, `
const fs = require('node:fs');
const scenario = process.env.NOONFLOW_PI_SCENARIO || 'normal';
if (process.argv.includes('bad-session')) {
  process.stderr.write("No session found matching 'bad-session'\\n");
  process.exit(2);
}
if (process.argv.includes('startup-failure')) {
  process.stderr.write("No models match pattern 'startup-failure'\\n");
  process.exit(2);
}
let buffer = '';
const commands = [];
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const command = JSON.parse(line);
    commands.push(command);
    fs.writeFileSync(process.env.NOONFLOW_PI_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), commands }));
    if (command.type === 'get_state') {
      send({ type: 'response', id: command.id, success: true, data: { sessionId: 'pi-session-1', model: { provider: 'test-provider', id: 'test-model' } } });
    }
    if (command.type === 'prompt') {
      send({ type: 'response', id: command.id, success: true });
      send({ type: 'agent_start' });
      if (scenario === 'retry-success') {
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'temporary provider error', content: [], usage: { input: 1, output: 0 } } });
        send({ type: 'agent_end', messages: [], willRetry: true });
        send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: 'temporary provider error' });
        send({ type: 'agent_start' });
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Recovered answer' } });
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Recovered answer' }], usage: { input: 2, output: 3 } } });
        send({ type: 'auto_retry_end', success: true, attempt: 1 });
        send({ type: 'agent_end', messages: [], willRetry: false });
        send({ type: 'agent_settled' });
        continue;
      }
      if (scenario === 'retry-final-failure') {
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'temporary provider error', content: [], usage: { input: 1, output: 0 } } });
        send({ type: 'agent_end', messages: [], willRetry: true });
        send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1, delayMs: 10, errorMessage: 'temporary provider error' });
        send({ type: 'agent_start' });
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'final provider error', content: [], usage: { input: 2, output: 0 } } });
        send({ type: 'agent_end', messages: [], willRetry: false });
        send({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'final provider error' });
        send({ type: 'agent_settled' });
        continue;
      }
      if (scenario === 'partial-output-retry') {
        send({ type: 'message_start', message: { role: 'assistant' } });
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Stale partial answer' } });
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Anthropic stream ended before message_stop', content: [{ type: 'text', text: 'Stale partial answer' }], usage: { input: 1, output: 2 } } });
        send({ type: 'agent_end', messages: [], willRetry: true });
        send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'Anthropic stream ended before message_stop' });
        setTimeout(() => {
          send({ type: 'agent_start' });
          send({ type: 'message_start', message: { role: 'assistant' } });
          send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Recovered answer' } });
          send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Recovered answer' }], usage: { input: 2, output: 2 } } });
          send({ type: 'auto_retry_end', success: true, attempt: 1 });
          send({ type: 'agent_end', messages: [], willRetry: false });
          send({ type: 'agent_settled' });
        }, 0);
        continue;
      }
      if (scenario === 'compaction-success') {
        send({ type: 'compaction_start', reason: 'threshold' });
        send({ type: 'compaction_end', reason: 'threshold', result: { summary: 'summary', firstKeptEntryId: 'entry-1', tokensBefore: 900, estimatedTokensAfter: 240 }, aborted: false, willRetry: false });
      }
      if (scenario === 'compaction-aborted') {
        send({ type: 'compaction_start', reason: 'overflow' });
        send({ type: 'compaction_end', reason: 'overflow', aborted: true, willRetry: false });
      }
      if (scenario === 'compaction-error') {
        send({ type: 'compaction_start', reason: 'manual' });
        send({ type: 'compaction_end', reason: 'manual', aborted: false, willRetry: false, errorMessage: 'Manual compaction fixture failed' });
      }
      if (scenario === 'compaction-missing-result') {
        send({ type: 'compaction_start', reason: 'threshold' });
        send({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false });
      }
      if (scenario === 'ordinary-event') {
        send({ type: 'auto_retry_end', reason: 'threshold', result: { tokensBefore: 700, estimatedTokensAfter: 200 }, aborted: false, success: true });
      }
      send({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'checking' } });
      send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', toolCall: { id: 'tool-1', name: 'read', arguments: { path: 'README.md' } } } });
      send({ type: 'tool_execution_end', toolCallId: 'tool-1', result: { content: [{ type: 'text', text: 'file content' }] }, isError: false });
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Pi answer' } });
      send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi answer' }], usage: { input: 3, output: 2, cacheRead: 1, cost: { total: 0.01 } } } });
      send({ type: 'agent_settled' });
    }
  }
});
`);
  piClientPlatform.findPiBinary = () => process.execPath;
  piClientPlatform.spawn = (_command, args, options) => spawn(
    process.execPath,
    [fakePiPath, ...args],
    { ...options, env: { ...options.env, NOONFLOW_PI_CAPTURE: capturePath, NOONFLOW_PI_SCENARIO: fakeScenario } },
  );
});

after(() => {
  piClientPlatform.findPiBinary = originalFind;
  piClientPlatform.spawn = originalSpawn;
  piClientPlatform.dangerouslySkipPermissionsEnabled = originalDangerousPermissions;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('streamPi', () => {
  it('round-trips provider-scoped model selections with native thinking levels', () => {
    assert.deepEqual(
      splitPiModelSelection('openai-codex/gpt-5.6-sol:xhigh'),
      { model: 'openai-codex/gpt-5.6-sol', thinkingLevel: 'xhigh' },
    );
    assert.equal(
      composePiModelSelection('openai-codex/gpt-5.6-sol:low', 'max'),
      'openai-codex/gpt-5.6-sol:max',
    );
    assert.deepEqual(
      splitPiModelSelection('custom/model:preview'),
      { model: 'custom/model:preview' },
    );
  });

  it('recognizes the standard npm Windows command shim', () => {
    assert.equal(
      parseWindowsPiShimScript('@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*\r\n'),
      'node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js',
    );
    assert.equal(
      parseWindowsPiShimScript('@"%~dp0\\node.exe" "%~dp0\\node_modules\\pi\\cli.js" %*'),
      'node_modules\\pi\\cli.js',
    );
    assert.equal(resolveWindowsPiNodeCommand(path.join(testDir, 'pi.cmd')), 'node.exe');
    assert.notEqual(resolveWindowsPiNodeCommand(path.join(testDir, 'pi.cmd')), process.execPath);
  });

  it('maps native RPC state, reasoning, tools, text, and usage into NoonFlow SSE', async () => {
    const payload = await readStream(streamPi({
      prompt: 'Inspect the repo',
      sessionId: 'local-session',
      model: 'test-model:high',
      systemPrompt: 'Stay concise',
      workingDirectory: testDir,
      permissionMode: 'plan',
    }));

    assert.match(payload, /pi-session-1/);
    assert.match(payload, /test-provider\/test-model/);
    assert.match(payload, /"type":"reasoning","data":"checking"/);
    assert.match(payload, /"type":"tool_use"/);
    assert.match(payload, /"type":"tool_result"/);
    assert.match(payload, /"type":"text","data":"Pi answer"/);
    assert.match(payload, /input_tokens\\":3/);
    assert.match(payload, /cost_usd\\":0.01/);
    assert.match(payload, /"type":"done"/);

    const activityEvents = payload
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string })
      .filter((event) => event.type === 'activity.updated')
      .map((event) => JSON.parse(event.data) as import('../../types').ChildActivity);
    assert.deepEqual(activityEvents, []);

    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as { argv: string[]; commands: Array<Record<string, unknown>> };
    assert.deepEqual(capture.argv.slice(0, 2), ['--mode', 'rpc']);
    assert.ok(capture.argv.includes('--model'));
    assert.ok(capture.argv.includes('test-model'));
    assert.ok(capture.argv.includes('--thinking'));
    assert.ok(capture.argv.includes('high'));
    assert.ok(capture.argv.includes('--tools'));
    assert.ok(capture.argv.includes('read,grep,find,ls'));
    assert.equal(capture.commands[0].type, 'get_state');
    assert.equal(capture.commands[1].type, 'prompt');

    const state = getRuntimeContextState('local-session');
    assert.equal(state?.runtime, 'pi');
    assert.equal(state?.source, 'unavailable');
    assert.equal(state?.currentContext, null);
    assert.deepEqual(state?.lastTurnUsage, {
      input_tokens: 3,
      output_tokens: 2,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 0,
      cost_usd: 0.01,
    });
    assert.deepEqual(state?.compaction, { status: 'idle' });
  });

  it('keeps the Pi process alive through a native retry and completes only after agent_settled', async () => {
    fakeScenario = 'retry-success';
    let payload = '';
    try {
      payload = await readStream(streamPi({
        prompt: 'Retry natively',
        sessionId: 'pi-retry-success',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    assert.match(payload, /Recovered answer/);
    assert.doesNotMatch(payload, /"type":"error"/);
    const activities = payload
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string })
      .filter((event) => event.type === 'activity.updated')
      .map((event) => JSON.parse(event.data) as import('../../types').ChildActivity);
    assert.deepEqual(activities, []);
  });

  it('rolls back a failed visible attempt and keeps the native retry result', async () => {
    fakeScenario = 'partial-output-retry';
    let payload = '';
    try {
      payload = await readStream(streamPi({
        prompt: 'Do not duplicate partial output',
        sessionId: 'pi-partial-output-retry',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    const events = payload
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string });
    assert.deepEqual(events
      .filter((event) => event.type === 'assistant_attempt_start'
        || event.type === 'assistant_attempt_reset'
        || event.type === 'text')
      .map((event) => [event.type, event.data]), [
        ['assistant_attempt_start', ''],
        ['text', 'Stale partial answer'],
        ['assistant_attempt_reset', ''],
        ['assistant_attempt_start', ''],
        ['text', 'Recovered answer'],
      ]);
    assert.equal(events.some((event) => event.type === 'error'), false);
    assert.ok(events.some((event) => (
      event.type === 'result'
      && JSON.parse(event.data).is_error === false
    )));
    assert.equal(events.some((event) => event.type === 'activity.updated'), false);
    assert.equal(events.at(-1)?.type, 'done');

    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as {
      commands: Array<{ type: string }>;
    };
    assert.equal(capture.commands.filter((command) => command.type === 'abort_retry').length, 0);
  });

  it('reports only the final Pi retry failure without top-level activity', async () => {
    fakeScenario = 'retry-final-failure';
    let payload = '';
    try {
      payload = await readStream(streamPi({
        prompt: 'Exhaust native retries',
        sessionId: 'pi-retry-failure',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    assert.match(payload, /"type":"error","data":"final provider error"/);
    assert.doesNotMatch(payload, /"type":"error","data":"temporary provider error"/);
    const activities = payload
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string })
      .filter((event) => event.type === 'activity.updated')
      .map((event) => JSON.parse(event.data) as import('../../types').ChildActivity);
    assert.deepEqual(activities, []);
  });

  it('maps native compaction success and keeps estimated post tokens explicitly approximate', async () => {
    fakeScenario = 'compaction-success';
    try {
      await readStream(streamPi({
        prompt: 'Compact natively',
        sessionId: 'pi-compact-success',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    const state = getRuntimeContextState('pi-compact-success');
    assert.equal(state?.source, 'unavailable');
    assert.equal(state?.currentContext, null);
    assert.equal(state?.compaction.status, 'completed');
    if (state?.compaction.status !== 'completed') assert.fail('expected completed Pi compaction');
    assert.equal(state.compaction.trigger, 'auto');
    assert.equal(state.compaction.preTokens, 900);
    assert.equal(state.compaction.postTokens, 240);
    assert.equal(state.compaction.postTokensEstimated, true);
    assert.equal(state.compaction.error, null);
  });

  it('maps native overflow compaction abort to a visible recovery failure', async () => {
    fakeScenario = 'compaction-aborted';
    try {
      await readStream(streamPi({
        prompt: 'Abort native compact',
        sessionId: 'pi-compact-aborted',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    const state = getRuntimeContextState('pi-compact-aborted');
    assert.equal(state?.compaction.status, 'failed');
    if (state?.compaction.status !== 'failed') assert.fail('expected failed Pi compaction');
    assert.equal(state.compaction.trigger, 'recovery');
    assert.match(state.compaction.error, /aborted/);
  });

  it('maps native manual compaction errors to a visible failure', async () => {
    fakeScenario = 'compaction-error';
    try {
      await readStream(streamPi({
        prompt: 'Fail native compact',
        sessionId: 'pi-compact-error',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    const state = getRuntimeContextState('pi-compact-error');
    assert.equal(state?.compaction.status, 'failed');
    if (state?.compaction.status !== 'failed') assert.fail('expected failed Pi compaction');
    assert.equal(state.compaction.trigger, 'manual');
    assert.equal(state.compaction.error, 'Manual compaction fixture failed');
  });

  it('rejects a non-aborted native compaction end that has no result', async () => {
    fakeScenario = 'compaction-missing-result';
    try {
      await readStream(streamPi({
        prompt: 'Missing compact result',
        sessionId: 'pi-compact-missing-result',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }

    const state = getRuntimeContextState('pi-compact-missing-result');
    assert.equal(state?.compaction.status, 'failed');
    if (state?.compaction.status !== 'failed') assert.fail('expected failed Pi compaction');
    assert.equal(state.compaction.trigger, 'auto');
    assert.match(state.compaction.error, /without a result/);
  });

  it('does not let an ordinary native event impersonate compaction completion', async () => {
    fakeScenario = 'ordinary-event';
    try {
      await readStream(streamPi({
        prompt: 'Ordinary event',
        sessionId: 'pi-ordinary-event',
        workingDirectory: testDir,
      }));
    } finally {
      fakeScenario = 'normal';
    }
    assert.deepEqual(getRuntimeContextState('pi-ordinary-event')?.compaction, { status: 'idle' });
  });

  it('limits code mode to read-only tools when dangerous permissions are disabled', async () => {
    piClientPlatform.dangerouslySkipPermissionsEnabled = () => false;
    try {
      const payload = await readStream(streamPi({
        prompt: 'Inspect safely',
        sessionId: 'safe-session',
        workingDirectory: testDir,
        permissionMode: 'acceptEdits',
      }));
      assert.match(payload, /Pi safe tools enabled/);
      const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as { argv: string[] };
      assert.ok(capture.argv.includes('--tools'));
      assert.ok(capture.argv.includes('read,grep,find,ls'));
    } finally {
      piClientPlatform.dangerouslySkipPermissionsEnabled = originalDangerousPermissions;
    }
  });

  it('invalidates a native resume id and retries with fallback history before the turn starts', async () => {
    let invalidated = false;
    const loadReasons: string[] = [];
    const payload = await readStream(streamPi({
      prompt: 'Continue',
      sessionId: 'local-session',
      sdkSessionId: 'bad-session',
      workingDirectory: testDir,
      loadEmergencyConversationHistory: (reason) => {
        loadReasons.push(reason);
        return [{ role: 'user', content: 'Earlier context' }];
      },
      onSessionIdInvalidated: () => { invalidated = true; },
    }));

    assert.equal(invalidated, true);
    assert.equal(loadReasons.length, 1);
    assert.match(loadReasons[0], /^native_resume_failed:No session found matching/);
    assert.match(payload, /Pi session reset/);
    assert.match(payload, /Pi answer/);
    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as { argv: string[]; commands: Array<{ type: string; message?: string }> };
    assert.equal(capture.argv.includes('--session'), false);
    assert.match(capture.commands.find((command) => command.type === 'prompt')?.message || '', /Earlier context/);
  });

  it('does not load or inject emergency history during a successful native resume', async () => {
    let loadCalls = 0;
    const payload = await readStream(streamPi({
      prompt: 'Continue native Pi session',
      sessionId: 'pi-resume-success',
      sdkSessionId: 'valid-session',
      workingDirectory: testDir,
      conversationHistory: [{ role: 'assistant', content: 'must not be injected' }],
      loadEmergencyConversationHistory: () => {
        loadCalls += 1;
        return [{ role: 'assistant', content: 'must not be loaded' }];
      },
    }));

    assert.match(payload, /Pi answer/);
    assert.equal(loadCalls, 0);
    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as {
      argv: string[];
      commands: Array<{ type: string; message?: string }>;
    };
    assert.ok(capture.argv.includes('--session'));
    const nativePrompt = capture.commands.find((command) => command.type === 'prompt')?.message || '';
    assert.match(nativePrompt, /Continue native Pi session/);
    assert.doesNotMatch(nativePrompt, /must not be injected|must not be loaded/);
  });

  it('preserves a native resume id for non-session startup failures', async () => {
    let invalidated = false;
    const payload = await readStream(streamPi({
      prompt: 'Continue',
      sessionId: 'local-session',
      sdkSessionId: 'valid-session',
      model: 'startup-failure',
      workingDirectory: testDir,
      onSessionIdInvalidated: () => { invalidated = true; },
    }));

    assert.equal(invalidated, false);
    assert.doesNotMatch(payload, /Pi session reset/);
    assert.match(payload, /No models match pattern/);
    assert.match(payload, /"type":"done"/);
  });
});
