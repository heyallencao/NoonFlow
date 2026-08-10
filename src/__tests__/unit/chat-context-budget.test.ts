import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installFakeCodexCli, readFakeCodexRequests } from './helpers/fake-codex-cli';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-chat-context-budget-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'noonflow.db'), 'w'));

const originalHome = process.env.HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalWarningLimit = process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT;
const originalSoftLimit = process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT;
const originalHardLimit = process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT;
const originalCodexBackend = process.env.NOONFLOW_CODEX_BACKEND;
const originalPublicCodexBackend = process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
const originalMonolithCodexBackend = process.env.MONOLITH_CODEX_BACKEND;
const originalPublicMonolithCodexBackend = process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
const fakeCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-context-budget-codex-home-'));
const fakeCodex = installFakeCodexCli(fakeCodexHome);
const fakePiPath = path.join(tmpDir, 'fake-route-pi.cjs');
const fakePiCapturePath = path.join(tmpDir, 'fake-route-pi-capture.json');

fs.writeFileSync(fakePiPath, `
const fs = require('node:fs');
if (process.argv.includes('pi-bad-session')) {
  process.stderr.write("No session found matching 'pi-bad-session'\\n");
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
      send({ type: 'response', id: command.id, success: true, data: { sessionId: 'pi-route-session', model: { provider: 'test', id: 'pi-model' }, autoCompactionEnabled: true } });
    }
    if (command.type === 'prompt') {
      send({ type: 'response', id: command.id, success: true });
      send({ type: 'agent_start' });
      if (process.env.NOONFLOW_PI_SCENARIO === 'partial-output-retry') {
        send({ type: 'message_start', message: { role: 'assistant' } });
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'stale route partial' } });
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Anthropic stream ended before message_stop', content: [{ type: 'text', text: 'stale route partial' }], usage: { input: 1, output: 2 } } });
        send({ type: 'agent_end', messages: [], willRetry: true });
        send({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: 'Anthropic stream ended before message_stop' });
        send({ type: 'agent_start' });
        send({ type: 'message_start', message: { role: 'assistant' } });
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'recovered route answer' } });
        send({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'recovered route answer' }], usage: { input: 2, output: 3 } } });
        send({ type: 'auto_retry_end', success: true, attempt: 1 });
        send({ type: 'agent_end', messages: [], willRetry: false });
        send({ type: 'agent_settled' });
        continue;
      }
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Pi route answer' } });
      send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Pi route answer' }], usage: { input: 4, output: 3 } } });
      send({ type: 'agent_settled' });
    }
  }
});
`);

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/route') as typeof import('../../app/api/chat/route');
const assistantRuntimes = require('../../lib/assistant-runtimes') as typeof import('../../lib/assistant-runtimes');
const piClient = require('../../lib/pi-client') as typeof import('../../lib/pi-client');

const originalFindCodexBinary = assistantRuntimes.assistantRuntimePlatform.findCodexBinary;
const originalGetCodexVersion = assistantRuntimes.assistantRuntimePlatform.getCodexVersion;
const originalFindPiBinary = piClient.piClientPlatform.findPiBinary;
const originalSpawnPi = piClient.piClientPlatform.spawn;

function parseSSEEvents(payload: string): Array<{ type: string; data: string }> {
  return payload
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string });
}

async function readStringStream(stream: ReadableStream<string> | null): Promise<string> {
  if (!stream) {
    return '';
  }

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

async function prepareNativeCodexRoute(scenario: string, threadId: string): Promise<void> {
  process.env.HOME = fakeCodexHome;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.NOONFLOW_CODEX_BACKEND = 'app-server';
  delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
  delete process.env.MONOLITH_CODEX_BACKEND;
  delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
  process.env.FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
  process.env.FAKE_CODEX_SCENARIO = scenario;
  process.env.FAKE_CODEX_THREAD_ID = threadId;
  fs.rmSync(fakeCodex.capturePath, { force: true });
  assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => fakeCodex.binaryPath;
  assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'codex-cli 0.145.0';
  const { clearShellEnvCache } = await import('../../lib/environment');
  clearShellEnvCache();
}

function prepareNativePiRoute(scenario = 'normal'): void {
  fs.rmSync(fakePiCapturePath, { force: true });
  piClient.piClientPlatform.findPiBinary = () => process.execPath;
  piClient.piClientPlatform.spawn = (_command, args, options) => spawn(
    process.execPath,
    [fakePiPath, ...args],
    { ...options, env: { ...options.env, NOONFLOW_PI_CAPTURE: fakePiCapturePath, NOONFLOW_PI_SCENARIO: scenario } },
  );
}

afterEach(() => {
  delete process.env.FAKE_CODEX_CAPTURE;
  delete process.env.FAKE_CODEX_SCENARIO;
  delete process.env.FAKE_CODEX_THREAD_ID;
  assistantRuntimes.assistantRuntimePlatform.findCodexBinary = originalFindCodexBinary;
  assistantRuntimes.assistantRuntimePlatform.getCodexVersion = originalGetCodexVersion;
  piClient.piClientPlatform.findPiBinary = originalFindPiBinary;
  piClient.piClientPlatform.spawn = originalSpawnPi;
  if (originalHome) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  if (originalOpenAiApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  }
  if (originalWarningLimit === undefined) {
    delete process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT;
  } else {
    process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT = originalWarningLimit;
  }
  if (originalSoftLimit === undefined) {
    delete process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT;
  } else {
    process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT = originalSoftLimit;
  }
  if (originalHardLimit === undefined) {
    delete process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT;
  } else {
    process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT = originalHardLimit;
  }
  if (originalCodexBackend === undefined) {
    delete process.env.NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NOONFLOW_CODEX_BACKEND = originalCodexBackend;
  }
  if (originalPublicCodexBackend === undefined) {
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND = originalPublicCodexBackend;
  }
  if (originalMonolithCodexBackend === undefined) {
    delete process.env.MONOLITH_CODEX_BACKEND;
  } else {
    process.env.MONOLITH_CODEX_BACKEND = originalMonolithCodexBackend;
  }
  if (originalPublicMonolithCodexBackend === undefined) {
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND = originalPublicMonolithCodexBackend;
  }
  db.closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(fakeCodexHome, { recursive: true, force: true });
});

describe('/api/chat context budget guard', () => {
  it('contains no local threshold compaction decision in any runtime client', () => {
    const clientSources = [
      'src/lib/claude-client.ts',
      'src/lib/codex-client.ts',
      'src/lib/pi-client.ts',
    ].map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');
    const piSource = fs.readFileSync(path.resolve('src/lib/pi-client.ts'), 'utf8');

    assert.doesNotMatch(clientSources, /default-context-sizes|CONTEXT_BUDGET_(?:WARNING|SOFT|HARD)|prepareConversationContext/);
    assert.doesNotMatch(piSource, /set_auto_compaction|autoCompactionEnabled\s*[:=]|type:\s*['"]compact['"]/);
  });

  it('passes an oversized native Codex request through without a character hard rejection', async () => {
    await prepareNativeCodexRoute('normal', 'thread-long-native');
    process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT = '60';
    process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT = '80';
    process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT = '120';

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-context-budget-workspace-'));
    const session = db.createSession(
      'Context Budget Guard',
      '',
      'S'.repeat(180),
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );

    const oversizedPrompt = 'X'.repeat(200_000);
    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: oversizedPrompt,
        client_message_id: 'msg-context-budget',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    const events = parseSSEEvents(payload);
    assert.equal(events.some((event) => event.type === 'error'), false);
    assert.ok(events.some((event) => event.type === 'text' && event.data === 'done-1'));
    assert.equal(events.some((event) => event.type === 'persisted'), true);
    assert.equal(events[0]?.type, 'user_persisted');

    const turnStart = readFakeCodexRequests(fakeCodex.capturePath)
      .find((entry) => entry.method === 'turn/start') as {
        params?: { input?: Array<{ type?: string; text?: string }> };
      };
    assert.ok((turnStart.params?.input?.[0]?.text?.length ?? 0) >= oversizedPrompt.length);

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 1);
  });

  it('resumes a native Codex thread without loading or injecting DB history', async () => {
    await prepareNativeCodexRoute('normal', 'thread-resumed');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-native-resume-workspace-'));
    const session = db.createSession(
      'Native Resume',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    db.addMessage(session.id, 'user', 'prior user context');
    db.addMessage(session.id, 'assistant', 'prior assistant context');
    db.updateSdkSessionId(session.id, 'thread-resumed');
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };

    try {
      const response = await route.POST(new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.id,
          content: 'continue native thread',
          client_message_id: 'msg-native-resume',
          assistant_runtime: 'codex',
        }),
      }) as never);
      assert.equal(response.status, 200);
      const payload = await readStringStream(response.body as ReadableStream<string> | null);
      assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);
    } finally {
      console.warn = originalWarn;
    }

    const requests = readFakeCodexRequests(fakeCodex.capturePath);
    assert.equal(requests.filter((entry) => entry.method === 'thread/resume').length, 1);
    assert.equal(requests.filter((entry) => entry.method === 'thread/start').length, 0);
    const turnStart = requests.find((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ text?: string }> };
    };
    const nativePrompt = turnStart.params?.input?.map((entry) => entry.text ?? '').join('\n') ?? '';
    assert.match(nativePrompt, /continue native thread/);
    assert.doesNotMatch(nativePrompt, /prior user context|prior assistant context/);
    assert.equal(
      warnings.some((args) => args[0] === '[chat API] emergency conversation context'),
      false,
    );
  });

  it('loads capped DB history lazily and emits structured emergency evidence after resume failure', async () => {
    await prepareNativeCodexRoute('resume-fail', 'thread-fallback');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-native-fallback-workspace-'));
    const session = db.createSession(
      'Native Resume Fallback',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    db.addMessage(session.id, 'user', 'history user marker');
    db.addMessage(session.id, 'assistant', 'history assistant marker');
    db.updateSdkSessionId(session.id, 'thread-stale');
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };

    try {
      const response = await route.POST(new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.id,
          content: 'continue after fallback',
          client_message_id: 'msg-native-fallback',
          assistant_runtime: 'codex',
        }),
      }) as never);
      assert.equal(response.status, 200);
      const payload = await readStringStream(response.body as ReadableStream<string> | null);
      assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);
    } finally {
      console.warn = originalWarn;
    }

    const requests = readFakeCodexRequests(fakeCodex.capturePath);
    assert.equal(requests.filter((entry) => entry.method === 'thread/resume').length, 1);
    assert.equal(requests.filter((entry) => entry.method === 'thread/start').length, 1);
    const turnStart = requests.find((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ text?: string }> };
    };
    const emergencyPrompt = turnStart.params?.input?.map((entry) => entry.text ?? '').join('\n') ?? '';
    assert.match(emergencyPrompt, /history user marker/);
    assert.match(emergencyPrompt, /history assistant marker/);

    const emergencyLog = warnings.find((args) => args[0] === '[chat API] emergency conversation context');
    assert.ok(emergencyLog);
    assert.deepEqual(emergencyLog?.[1], {
      session: session.id,
      runtime: 'codex',
      reason: 'native_resume_failed:thread/resume failed: resume failed',
      history_messages_before: 2,
      history_messages_after: 2,
      characters_trimmed: false,
    });
  });

  it('resumes native Pi without reading or injecting DB emergency history', async () => {
    prepareNativePiRoute();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-resume-workspace-'));
    const session = db.createSession(
      'Pi Native Resume',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'pi',
    );
    db.addMessage(session.id, 'user', 'pi prior user marker');
    db.addMessage(session.id, 'assistant', 'pi prior assistant marker');
    db.updateSdkSessionId(session.id, 'pi-valid-session');
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };

    try {
      const response = await route.POST(new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.id,
          content: 'continue native Pi',
          client_message_id: 'msg-pi-native-resume',
          assistant_runtime: 'pi',
        }),
      }) as never);
      assert.equal(response.status, 200);
      const payload = await readStringStream(response.body as ReadableStream<string> | null);
      assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);
    } finally {
      console.warn = originalWarn;
    }

    const capture = JSON.parse(fs.readFileSync(fakePiCapturePath, 'utf8')) as {
      argv: string[];
      commands: Array<{ type: string; message?: string }>;
    };
    assert.ok(capture.argv.includes('--session'));
    assert.ok(capture.argv.includes('pi-valid-session'));
    const nativePrompt = capture.commands.find((command) => command.type === 'prompt')?.message || '';
    assert.match(nativePrompt, /continue native Pi/);
    assert.doesNotMatch(nativePrompt, /pi prior user marker|pi prior assistant marker/);
    assert.equal(
      warnings.some((args) => args[0] === '[chat API] emergency conversation context'),
      false,
    );
  });

  it('persists only the successful Pi retry attempt after rolling back partial output', async () => {
    prepareNativePiRoute('partial-output-retry');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-retry-workspace-'));
    const session = db.createSession(
      'Pi Retry Persistence',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'pi',
    );

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'retry and persist once',
        client_message_id: 'msg-pi-retry-persistence',
        assistant_runtime: 'pi',
      }),
    }) as never);
    assert.equal(response.status, 200);
    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);

    const assistant = db.getMessages(session.id).messages.filter((message) => message.role === 'assistant').at(-1);
    assert.ok(assistant);
    assert.match(assistant.content, /recovered route answer/);
    assert.doesNotMatch(assistant.content, /stale route partial/);
    assert.equal(assistant.status, 'completed');
  });

  it('loads capped DB history only after native Pi resume fails', async () => {
    prepareNativePiRoute();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-fallback-workspace-'));
    const session = db.createSession(
      'Pi Native Fallback',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'pi',
    );
    db.addMessage(session.id, 'user', 'pi fallback user marker');
    db.addMessage(session.id, 'assistant', 'pi fallback assistant marker');
    db.updateSdkSessionId(session.id, 'pi-bad-session');
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };

    try {
      const response = await route.POST(new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.id,
          content: 'continue after Pi fallback',
          client_message_id: 'msg-pi-native-fallback',
          assistant_runtime: 'pi',
        }),
      }) as never);
      assert.equal(response.status, 200);
      const payload = await readStringStream(response.body as ReadableStream<string> | null);
      assert.equal(parseSSEEvents(payload).some((event) => event.type === 'error'), false);
    } finally {
      console.warn = originalWarn;
    }

    const capture = JSON.parse(fs.readFileSync(fakePiCapturePath, 'utf8')) as {
      argv: string[];
      commands: Array<{ type: string; message?: string }>;
    };
    assert.equal(capture.argv.includes('--session'), false);
    const emergencyPrompt = capture.commands.find((command) => command.type === 'prompt')?.message || '';
    assert.match(emergencyPrompt, /pi fallback user marker/);
    assert.match(emergencyPrompt, /pi fallback assistant marker/);
    const emergencyLog = warnings.find((args) => args[0] === '[chat API] emergency conversation context');
    assert.ok(emergencyLog);
    assert.deepEqual(emergencyLog?.[1], {
      session: session.id,
      runtime: 'pi',
      reason: "native_resume_failed:No session found matching 'pi-bad-session'",
      history_messages_before: 2,
      history_messages_after: 2,
      characters_trimmed: false,
    });
  });
});
