import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseWindowsPiShimScript, piClientPlatform, resolveWindowsPiNodeCommand, streamPi } from '../../lib/pi-client';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-rpc-'));
const fakePiPath = path.join(testDir, 'fake-pi.cjs');
const capturePath = path.join(testDir, 'capture.json');
const originalFind = piClientPlatform.findPiBinary;
const originalSpawn = piClientPlatform.spawn;
const originalDangerousPermissions = piClientPlatform.dangerouslySkipPermissionsEnabled;

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
    { ...options, env: { ...options.env, NOONFLOW_PI_CAPTURE: capturePath } },
  );
});

after(() => {
  piClientPlatform.findPiBinary = originalFind;
  piClientPlatform.spawn = originalSpawn;
  piClientPlatform.dangerouslySkipPermissionsEnabled = originalDangerousPermissions;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('streamPi', () => {
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
      model: 'test-model',
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

    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as { argv: string[]; commands: Array<Record<string, unknown>> };
    assert.deepEqual(capture.argv.slice(0, 2), ['--mode', 'rpc']);
    assert.ok(capture.argv.includes('--tools'));
    assert.ok(capture.argv.includes('read,grep,find,ls'));
    assert.equal(capture.commands[0].type, 'get_state');
    assert.equal(capture.commands[1].type, 'prompt');
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
    const payload = await readStream(streamPi({
      prompt: 'Continue',
      sessionId: 'local-session',
      sdkSessionId: 'bad-session',
      workingDirectory: testDir,
      fallbackConversationHistory: [{ role: 'user', content: 'Earlier context' }],
      onSessionIdInvalidated: () => { invalidated = true; },
    }));

    assert.equal(invalidated, true);
    assert.match(payload, /Pi session reset/);
    assert.match(payload, /Pi answer/);
    const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8')) as { argv: string[]; commands: Array<{ type: string; message?: string }> };
    assert.equal(capture.argv.includes('--session'), false);
    assert.match(capture.commands.find((command) => command.type === 'prompt')?.message || '', /Earlier context/);
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
