import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SETTING_KEYS } from '../../types';
import { installFakeCodexCli, readFakeCodexRequests } from './helpers/fake-codex-cli';

let importVersion = 0;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-app-server-home-'));
const fakeCli = installFakeCodexCli(fakeHome);
const originalEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  CLAUDE_GUI_DATA_DIR: process.env.CLAUDE_GUI_DATA_DIR,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  NOONFLOW_CODEX_BACKEND: process.env.NOONFLOW_CODEX_BACKEND,
  NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND: process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND,
  NOONFLOW_CODEX_COMPACTION_TIMEOUT_MS: process.env.NOONFLOW_CODEX_COMPACTION_TIMEOUT_MS,
};
process.env.CLAUDE_GUI_DATA_DIR = fakeHome;

async function importFreshCodexClient() {
  const moduleUrl = pathToFileURL(path.resolve('src/lib/codex-client.ts'));
  moduleUrl.searchParams.set('v', String(importVersion += 1));
  return import(moduleUrl.href);
}

async function readStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks.join('');
}

function parseSSE(payload: string): Array<{ type: string; data: string }> {
  return payload.split('\n\n').map((chunk) => chunk.trim()).filter(Boolean)
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as { type: string; data: string });
}

async function prepareFake(scenario = 'normal') {
  process.env.HOME = fakeHome;
  process.env.PATH = `${path.dirname(fakeCli.binaryPath)}${path.delimiter}${originalEnv.PATH ?? ''}`;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.NOONFLOW_CODEX_BACKEND = 'app-server';
  process.env.NOONFLOW_CODEX_COMPACTION_TIMEOUT_MS = '120';
  process.env.FAKE_CODEX_SCENARIO = scenario;
  process.env.FAKE_CODEX_CAPTURE = fakeCli.capturePath;
  process.env.FAKE_CODEX_MARKER = fakeCli.markerPath;
  delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
  delete process.env.FAKE_CODEX_VERSION;
  fs.rmSync(fakeCli.capturePath, { force: true });
  fs.rmSync(fakeCli.markerPath, { force: true });
  installFakeCodexCli(fakeHome);
  const { clearShellEnvCache } = await import('../../lib/environment');
  clearShellEnvCache();
}

afterEach(async () => {
  delete process.env.FAKE_CODEX_SCENARIO;
  delete process.env.FAKE_CODEX_CAPTURE;
  delete process.env.FAKE_CODEX_MARKER;
  delete process.env.FAKE_CODEX_VERSION;
  const { clearShellEnvCache } = await import('../../lib/environment');
  clearShellEnvCache();
});

after(async () => {
  const db = await import('../../lib/db');
  db.closeDb();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe('Windows Codex app-server executable resolution', () => {
  function installWindowsLayout(legacy = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-win32-'));
    const wrapperPath = path.join(root, 'codex.cmd');
    const entrypoint = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const targetRoot = path.join(
      root,
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
    );
    const executablePath = legacy
      ? path.join(targetRoot, 'codex', 'codex.exe')
      : path.join(targetRoot, 'bin', 'codex.exe');
    const pathDirectory = path.join(targetRoot, legacy ? 'path' : 'codex-path');
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, '#!/usr/bin/env node\n');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', '@openai', 'codex-win32-x64', 'package.json'), '{}\n');
    if (!legacy) fs.writeFileSync(path.join(targetRoot, 'codex-package.json'), '{}\n');
    fs.writeFileSync(executablePath, 'fixture');
    fs.mkdirSync(pathDirectory, { recursive: true });
    fs.writeFileSync(path.join(pathDirectory, 'rg.exe'), 'fixture');
    fs.writeFileSync(
      wrapperPath,
      '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    return { root, wrapperPath, entrypoint, executablePath, pathDirectory };
  }

  it('resolves an npm codex.cmd wrapper to the installed x64 native executable', async () => {
    const fixture = installWindowsLayout();
    try {
      const client = await importFreshCodexClient();
      const launch = client.__resolveCodexAppServerLaunchForTests(
        fixture.wrapperPath,
        { Path: 'C:\\Windows\\System32', PATH: 'stale' },
        'win32',
        'x64',
      );
      assert.equal(launch.executablePath, fs.realpathSync(fixture.executablePath));
      assert.equal(launch.env.Path, `${fs.realpathSync(fixture.pathDirectory)};C:\\Windows\\System32`);
      assert.equal(launch.env.PATH, undefined);
      assert.equal(launch.env.CODEX_MANAGED_PACKAGE_ROOT, fs.realpathSync(path.dirname(path.dirname(fixture.entrypoint))));
      assert.equal(launch.env.CODEX_MANAGED_BY_NPM, '1');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('resolves the legacy Windows package layout for app-server', async () => {
    const fixture = installWindowsLayout(true);
    try {
      const client = await importFreshCodexClient();
      const launch = client.__resolveCodexAppServerLaunchForTests(
        fixture.wrapperPath,
        { PATH: 'C:\\Windows\\System32' },
        'win32',
        'x64',
      );
      assert.equal(launch.executablePath, fs.realpathSync(fixture.executablePath));
      assert.equal(launch.env.PATH, `${fs.realpathSync(fixture.pathDirectory)};C:\\Windows\\System32`);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails clearly when a Windows wrapper cannot resolve its native executable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-win32-missing-'));
    const wrapperPath = path.join(root, 'codex.cmd');
    fs.writeFileSync(
      wrapperPath,
      '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    try {
      const client = await importFreshCodexClient();
      assert.throws(
        () => client.__resolveCodexAppServerLaunchForTests(wrapperPath, {}, 'win32', 'x64'),
        /native Windows executable could not be resolved.*Reinstall Codex/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes native Windows executables through unchanged', async () => {
    const client = await importFreshCodexClient();
    const env = { Path: 'C:\\Windows\\System32' };
    const launch = client.__resolveCodexAppServerLaunchForTests(
      'C:\\Users\\allen\\Codex\\codex.exe', env, 'win32', 'x64',
    );
    assert.equal(launch.executablePath, 'C:\\Users\\allen\\Codex\\codex.exe');
    assert.equal(launch.env, env);
  });
});

describe('streamCodex app-server', () => {
  it('rejects ask mode before enabling any Codex tool access', async () => {
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'explain', sessionId: 'ask', permissionMode: 'default' }));
    assert.match(payload, /does not support ask mode/);
    assert.equal(parseSSE(payload).filter((event) => event.type === 'done').length, 1);
  });

  it('reports an actionable error when the local CLI is missing', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-no-codex-'));
    const savedHome = process.env.HOME;
    const savedPath = process.env.PATH;
    process.env.HOME = emptyHome;
    process.env.PATH = '/usr/bin:/bin';
    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({ prompt: 'hello', sessionId: 'missing' }));
      assert.match(payload, /Codex CLI is not installed/);
      assert.match(payload, /npm install -g @openai\/codex/);
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      process.env.PATH = savedPath;
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('rejects a local CLI below the app-server minimum version', async () => {
    await prepareFake();
    process.env.FAKE_CODEX_VERSION = '0.120.0';
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'hello', sessionId: 'old-version' }));
    assert.match(payload, /too old/);
    assert.match(payload, /0\.145\.0 or newer/);
  });

  it('performs initialize, thread/start, and turn/start over JSONL', async () => {
    await prepareFake();
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'hello', sessionId: 'normal' }));
    const methods = readFakeCodexRequests(fakeCli.capturePath).map((entry) => entry.method);
    assert.deepEqual(methods.slice(0, 4), ['initialize', 'initialized', 'thread/start', 'turn/start']);
    assert.match(payload, /"type":"text","data":"done-1"/);
    assert.equal(parseSSE(payload).filter((event) => event.type === 'done').length, 1);
  });

  it('routes earlier agent messages to reasoning and keeps the last one as the final answer', async () => {
    await prepareFake('multiple-agent-messages');
    const db = await import('../../lib/db');
    db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'true');
    try {
      const { streamCodex } = await importFreshCodexClient();
      const events = parseSSE(await readStream(streamCodex({ prompt: 'explain', sessionId: 'reasoning' })));
      assert.ok(events.some((event) => event.type === 'reasoning' && event.data === 'analysis note'));
      assert.ok(events.some((event) => event.type === 'text' && event.data === 'done-1'));
    } finally {
      db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'false');
    }
  });

  it('resumes an existing native thread and sends only the new turn', async () => {
    await prepareFake();
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({
      prompt: 'new turn', sessionId: 'resume', sdkSessionId: 'thread-existing',
      systemPrompt: 'rule', conversationHistory: [{ role: 'user', content: 'old history' }],
    }));
    const requests = readFakeCodexRequests(fakeCli.capturePath);
    const resume = requests.find((entry) => entry.method === 'thread/resume') as { params?: Record<string, unknown> };
    const turn = requests.find((entry) => entry.method === 'turn/start') as { params?: { input?: Array<{ text?: string }> } };
    assert.equal(resume.params?.threadId, 'thread-existing');
    assert.doesNotMatch(turn.params?.input?.[0]?.text ?? '', /old history|rule/);
  });

  it('separates prompt from supported image input', async () => {
    await prepareFake();
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({
      prompt: 'image', sessionId: 'image',
      files: [{ id: '1', name: 'x.jpg', type: 'image/jpeg', size: 1, data: '', filePath: '/tmp/x.jpg' }],
    }));
    const turn = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ type?: string; path?: string; text?: string }> };
    };
    assert.equal(turn.params?.input?.[0]?.text, 'image');
    assert.ok(turn.params?.input?.some((entry) => entry.type === 'localImage' && entry.path === '/tmp/x.jpg'));
  });

  it('does not send unsupported image formats as localImage', async () => {
    await prepareFake();
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({
      prompt: 'image', sessionId: 'png',
      files: [{ id: '1', name: 'x.png', type: 'image/png', size: 1, data: '', filePath: '/tmp/x.png' }],
    }));
    const turn = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ type?: string }> };
    };
    assert.ok(!turn.params?.input?.some((entry) => entry.type === 'localImage'));
    assert.match(payload, /unsupported formats for Codex vision/);
  });

  it('falls back to fresh app-server with lazily loaded emergency history when resume fails', async () => {
    await prepareFake('resume-fail');
    const { streamCodex } = await importFreshCodexClient();
    let invalidated = 0;
    const reasons: string[] = [];
    const payload = await readStream(streamCodex({
      prompt: 'retry', sessionId: 'resume-fail', sdkSessionId: 'stale',
      loadEmergencyConversationHistory: (reason: string) => {
        reasons.push(reason);
        return [{ role: 'assistant', content: 'prior answer' }];
      },
      onSessionIdInvalidated: () => { invalidated += 1; },
    }));
    const requests = readFakeCodexRequests(fakeCli.capturePath);
    const lastTurn = requests.findLast((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ text?: string }> };
    };
    assert.equal(invalidated, 1);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /native_resume_failed/);
    assert.match(lastTurn.params?.input?.[0]?.text ?? '', /prior answer/);
    assert.match(payload, /Session fallback/);
  });

  it('falls back when the first app-server event is an error before turn start', async () => {
    await prepareFake('resume-error-before-event');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({
      prompt: 'retry', sessionId: 'resume-event-error', sdkSessionId: 'thread-stale',
      loadEmergencyConversationHistory: () => [{ role: 'user', content: 'emergency context' }],
    }));
    const requests = readFakeCodexRequests(fakeCli.capturePath);
    assert.equal(requests.filter((entry) => entry.method === 'thread/resume').length, 1);
    assert.equal(requests.filter((entry) => entry.method === 'thread/start').length, 1);
    assert.match(payload, /done-1/);
  });

  it('passes model and reasoning effort through native protocol fields', async () => {
    await prepareFake();
    const db = await import('../../lib/db');
    db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'true');
    try {
      const { streamCodex } = await importFreshCodexClient();
      await readStream(streamCodex({ prompt: 'effort', sessionId: 'effort', model: 'gpt-5.4-xhigh' }));
      const requests = readFakeCodexRequests(fakeCli.capturePath);
      const start = requests.find((entry) => entry.method === 'thread/start') as { params?: Record<string, unknown> };
      const turn = requests.find((entry) => entry.method === 'turn/start') as { params?: Record<string, unknown> };
      assert.equal(start.params?.model, 'gpt-5.4');
      assert.equal(turn.params?.effort, 'xhigh');
    } finally {
      db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'false');
    }
  });

  it('maps legacy middle suffix to medium native reasoning effort', async () => {
    await prepareFake();
    const db = await import('../../lib/db');
    db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'true');
    try {
      const { streamCodex } = await importFreshCodexClient();
      await readStream(streamCodex({ prompt: 'effort', sessionId: 'middle', model: 'gpt-5.4-middle' }));
      const turn = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.method === 'turn/start') as {
        params?: Record<string, unknown>;
      };
      assert.equal(turn.params?.model, 'gpt-5.4');
      assert.equal(turn.params?.effort, 'medium');
    } finally {
      db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'false');
    }
  });

  it('keeps the status model suffix but omits native effort when reasoning is disabled', async () => {
    await prepareFake();
    const db = await import('../../lib/db');
    db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'false');
    const { streamCodex } = await importFreshCodexClient();
    const events = parseSSE(await readStream(streamCodex({
      prompt: 'status', sessionId: 'status-model', model: 'gpt-5.4-high',
    })));
    const turn = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.method === 'turn/start') as {
      params?: Record<string, unknown>;
    };
    const status = events.find((event) => event.type === 'status' && event.data.includes('session_id'));
    assert.equal(turn.params?.model, 'gpt-5.4');
    assert.equal(turn.params?.effort, undefined);
    assert.equal(JSON.parse(status?.data ?? '{}').model, 'gpt-5.4-high');
  });

  it('keeps long context in turn/start JSON and out of process argv', async () => {
    await prepareFake();
    const prompt = `long-${'x'.repeat(220_000)}`;
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({ prompt, sessionId: 'long' }));
    const turn = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.method === 'turn/start') as {
      params?: { input?: Array<{ text?: string }> };
    };
    assert.equal(turn.params?.input?.[0]?.text, prompt);
  });

  it('keeps non-terminal Codex item errors as warnings when the turn completes', async () => {
    await prepareFake('item-warning');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'warning', sessionId: 'warning' }));
    assert.match(payload, /done-1/);
    assert.equal(parseSSE(payload).some((event) => event.type === 'error'), false);
  });

  it('fails with the item error when the process exits before turn completion', async () => {
    await prepareFake('item-error-exit');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'error', sessionId: 'item-error' }));
    assert.match(payload, /item failure before exit/);
    assert.equal(parseSSE(payload).filter((event) => event.type === 'done').length, 1);
  });

  it('normalizes removed SDK backend values to app-server', async () => {
    await prepareFake();
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({ prompt: 'migrate', sessionId: 'old-backend' }));
    assert.ok(readFakeCodexRequests(fakeCli.capturePath).some((entry) => entry.method === 'initialize'));
  });

  it('keeps the external CLI path when resume falls back to a fresh app-server', async () => {
    await prepareFake('resume-fail');
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({
      prompt: 'fallback', sessionId: 'path-fallback', sdkSessionId: 'stale',
      loadEmergencyConversationHistory: () => [],
    }));
    const methods = readFakeCodexRequests(fakeCli.capturePath).map((entry) => entry.method);
    assert.equal(methods.filter((method) => method === 'initialize').length, 2);
    assert.ok(methods.includes('thread/start'));
  });

  it('does not double-count cached Codex input tokens', async () => {
    await prepareFake();
    const { streamCodex, normalizeCodexAppServerTurnUsage } = await importFreshCodexClient();
    assert.deepEqual(normalizeCodexAppServerTurnUsage({
      inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 10,
    }), {
      input_tokens: 70,
      output_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    });
    const result = parseSSE(await readStream(streamCodex({ prompt: 'usage', sessionId: 'usage' })))
      .find((event) => event.type === 'result');
    const usage = JSON.parse(result?.data ?? '{}').usage as Record<string, number>;
    assert.equal(Object.values(usage).reduce((sum, value) => sum + value, 0), 110);
  });

  it('uses native last total for current context instead of cumulative thread total', async () => {
    await prepareFake();
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({ prompt: 'context', sessionId: 'context-native' }));
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('context-native');
    assert.equal(state?.source, 'native');
    assert.equal(state?.currentContext?.usedTokens, 110);
    assert.equal(state?.currentContext?.contextWindowTokens, 1_000);
    assert.equal(state?.currentContext?.percentage, 11);
    assert.deepEqual(state?.lastTurnUsage, {
      input_tokens: 70,
      output_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    });
  });

  it('runs native compact, waits for completed contextCompaction, then retries once', async () => {
    await prepareFake('context-window');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact' }));
    const methods = readFakeCodexRequests(fakeCli.capturePath).map((entry) => entry.method);
    assert.equal(methods.filter((method) => method === 'turn/start').length, 2);
    assert.equal(methods.filter((method) => method === 'thread/compact/start').length, 1);
    assert.ok(methods.indexOf('thread/compact/start') < methods.lastIndexOf('turn/start'));
    assert.match(payload, /done-2/);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('compact');
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.trigger, 'recovery');
    assert.equal(state?.compaction.preTokens, 900);
    assert.equal(state?.compaction.postTokens, 300);
    assert.equal(state?.compaction.postTokensEstimated, false);
    assert.equal(state?.compaction.startedAt, 1111);
    assert.equal(state?.compaction.completedAt, 2222);
    assert.equal(state?.currentContext?.usedTokens, 110);
  });

  it('does not attribute the retried turn usage to the compact turn', async () => {
    await prepareFake('context-window-no-post-usage');
    const { streamCodex } = await importFreshCodexClient();
    await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact-no-post' }));
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('compact-no-post');
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.postTokens, null);
    assert.equal(state?.currentContext?.usedTokens, 110);
  });

  it('does not treat compact RPC, thread/compacted, turn completion, or an ordinary item as completion', async () => {
    await prepareFake('context-window-no-completion');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact-strict' }));
    assert.match(payload, /timed out before contextCompaction completed/);
    assert.equal(readFakeCodexRequests(fakeCli.capturePath).filter((entry) => entry.method === 'turn/start').length, 1);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    assert.equal(getRuntimeContextState('compact-strict')?.compaction.status, 'failed');
  });

  it('retries the original turn at most once after native compaction', async () => {
    await prepareFake('context-window-twice');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact-twice' }));
    assert.match(payload, /after native compact and one retry/);
    assert.equal(readFakeCodexRequests(fakeCli.capturePath).filter((entry) => entry.method === 'turn/start').length, 2);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('compact-twice');
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.error, null);
  });

  it('keeps native completion authoritative when the compact RPC errors afterward', async () => {
    await prepareFake('context-window-compact-rpc-error-after-completed');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact-rpc-error' }));
    assert.match(payload, /done-2/);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('compact-rpc-error');
    assert.equal(state?.compaction.status, 'completed');
    assert.equal(state?.compaction.error, null);
  });

  it('continues after native completion when the compact RPC never responds', async () => {
    await prepareFake('context-window-compact-rpc-hang-after-completed');
    const { streamCodex } = await importFreshCodexClient();
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), 2_000);
    const payload = await readStream(streamCodex({
      prompt: 'compact',
      sessionId: 'compact-rpc-hang',
      abortController,
    }));
    clearTimeout(abortTimer);
    assert.match(payload, /done-2/);
    assert.doesNotMatch(payload, /stopped by user/);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    assert.equal(getRuntimeContextState('compact-rpc-hang')?.compaction.status, 'completed');
  });

  it('marks compaction failed on a fatal app-server exit without an unhandled completion wait', async () => {
    await prepareFake('context-window-compact-fatal');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'compact', sessionId: 'compact-fatal' }));
    assert.match(payload, /exited unexpectedly/);
    const { getRuntimeContextState } = await import('../../lib/context-runtime');
    const state = getRuntimeContextState('compact-fatal');
    assert.equal(state?.compaction.status, 'failed');
    assert.match(state?.compaction.error ?? '', /exited unexpectedly/);
  });

  it('surfaces an abnormal app-server process exit once', async () => {
    await prepareFake('process-exit');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'exit', sessionId: 'exit' }));
    assert.match(payload, /exited unexpectedly/);
    assert.equal(parseSSE(payload).filter((event) => event.type === 'done').length, 1);
  });

  it('fails on malformed app-server JSONL', async () => {
    await prepareFake('invalid-json');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'bad json', sessionId: 'bad-json' }));
    assert.match(payload, /invalid JSONL/);
  });

  it('round-trips command approval through the existing permission boundary', async () => {
    await prepareFake('approval');
    const { streamCodex } = await importFreshCodexClient();
    const { resolvePendingPermission } = await import('../../lib/permission-registry');
    const reader = streamCodex({ prompt: 'approve', sessionId: 'approval' }).getReader();
    let payload = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      payload += value;
      const permission = parseSSE(payload).find((event) => event.type === 'permission_request');
      if (permission) {
        const data = JSON.parse(permission.data) as { permissionRequestId: string };
        resolvePendingPermission(data.permissionRequestId, { behavior: 'allow', updatedInput: {} });
      }
    }
    const response = readFakeCodexRequests(fakeCli.capturePath).find((entry) => entry.id === 'approval-1') as {
      result?: { decision?: string };
    };
    assert.equal(response.result?.decision, 'accept');
    assert.match(payload, /done-1/);
  });

  it('interrupts a hanging native turn when stopped', async () => {
    await prepareFake('hang');
    const abortController = new AbortController();
    const { streamCodex } = await importFreshCodexClient();
    const pending = readStream(streamCodex({ prompt: 'hang', sessionId: 'stop', abortController }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    abortController.abort();
    const payload = await pending;
    assert.match(payload, /stopped by user/);
    assert.ok(readFakeCodexRequests(fakeCli.capturePath).some((entry) => entry.method === 'turn/interrupt'));
  });

  it('surfaces a native failed turn without local fallback', async () => {
    await prepareFake('turn-fail');
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({ prompt: 'fail', sessionId: 'fail' }));
    assert.match(payload, /native turn failed/);
    assert.equal(readFakeCodexRequests(fakeCli.capturePath).filter((entry) => entry.method === 'turn/start').length, 1);
  });

  it('ignores a stale backend environment value and still uses app-server', async () => {
    await prepareFake();
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';
    const { streamCodex } = await importFreshCodexClient();
    const payload = await readStream(streamCodex({
      prompt: `stale-config-${'x'.repeat(20_000)}`,
      sessionId: 'stale-backend',
    }));
    const methods = readFakeCodexRequests(fakeCli.capturePath).map((entry) => entry.method);
    assert.deepEqual(methods.slice(0, 4), ['initialize', 'initialized', 'thread/start', 'turn/start']);
    assert.match(payload, /done-1/);
  });

  it('removes alternate Codex backend implementations and selectors', () => {
    assert.equal(fs.existsSync(path.resolve('src/lib/codex/legacy-cli.ts')), false);
    assert.equal(fs.existsSync(path.resolve('src/lib/codex-backend.ts')), false);
    const source = fs.readFileSync(path.resolve('src/lib/codex-client.ts'), 'utf8');
    assert.doesNotMatch(source, /runLegacyAttempt|buildLegacyCodexArgs|getCodexBackend/);
  });

  it('contains no Codex SDK import or dependency path', () => {
    const source = fs.readFileSync(path.resolve('src/lib/codex-client.ts'), 'utf8');
    const packageJson = fs.readFileSync(path.resolve('package.json'), 'utf8');
    const packageLock = fs.readFileSync(path.resolve('package-lock.json'), 'utf8');
    assert.doesNotMatch(source, /@openai\/codex-sdk/);
    assert.doesNotMatch(packageJson, /@openai\/codex-sdk/);
    assert.doesNotMatch(packageLock, /node_modules\/@openai\/codex-sdk/);
  });
});
