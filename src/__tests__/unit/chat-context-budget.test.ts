import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-chat-context-budget-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'noonflow.db'), 'w'));

const originalHome = process.env.HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalWarningLimit = process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT;
const originalSoftLimit = process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT;
const originalHardLimit = process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT;
const originalCodexBackend = process.env.NOONFLOW_CODEX_BACKEND;

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/route') as typeof import('../../app/api/chat/route');
const assistantRuntimes = require('../../lib/assistant-runtimes') as typeof import('../../lib/assistant-runtimes');

const originalFindCodexBinary = assistantRuntimes.assistantRuntimePlatform.findCodexBinary;
const originalGetCodexVersion = assistantRuntimes.assistantRuntimePlatform.getCodexVersion;

function writeFakeCodexBinary(events: string[]): string {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-context-budget-codex-home-'));
  const binaryPath = path.join(fakeHome, '.noonflow', 'bin', 'codex');
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, `#!/bin/sh
cat <<'__MONOLITH_CODEX_EVENTS__'
${events.join('\n')}
__MONOLITH_CODEX_EVENTS__
`);
  fs.chmodSync(binaryPath, 0o755);
  return fakeHome;
}

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

afterEach(() => {
  assistantRuntimes.assistantRuntimePlatform.findCodexBinary = originalFindCodexBinary;
  assistantRuntimes.assistantRuntimePlatform.getCodexVersion = originalGetCodexVersion;
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
  db.closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/chat context budget guard', () => {
  it('returns an SSE error stream instead of a bare 500 when hard limit is exceeded before runtime start', async () => {
    const fakeHome = writeFakeCodexBinary([
      '{"type":"thread.started","thread_id":"unused"}',
      '{"type":"turn.started"}',
    ]);

    process.env.HOME = fakeHome;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.NOONFLOW_CONTEXT_BUDGET_WARNING_LIMIT = '60';
    process.env.NOONFLOW_CONTEXT_BUDGET_SOFT_LIMIT = '80';
    process.env.NOONFLOW_CONTEXT_BUDGET_HARD_LIMIT = '120';
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';

    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => path.join(fakeHome, '.noonflow', 'bin', 'codex');
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

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

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'continue',
        client_message_id: 'msg-context-budget',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    const events = parseSSEEvents(payload);
    const errorEvent = events.find((event) => event.type === 'error');

    assert.ok(errorEvent, 'expected an SSE error event');
    assert.match(errorEvent.data, /本轮上下文超出限制/);
    assert.equal(events.some((event) => event.type === 'persisted'), false);
    assert.equal(events[0]?.type, 'user_persisted');

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 0);
  });
});
