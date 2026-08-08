import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-route-idempotency-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));
const originalHome = process.env.HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalCodexBackend = process.env.MONOLITH_CODEX_BACKEND;
const originalPublicCodexBackend = process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/route') as typeof import('../../app/api/chat/route');
const assistantRuntimes = require('../../lib/assistant-runtimes') as typeof import('../../lib/assistant-runtimes');
const codexClient = require('../../lib/codex-client') as typeof import('../../lib/codex-client');

const originalFindCodexBinary = assistantRuntimes.assistantRuntimePlatform.findCodexBinary;
const originalGetCodexVersion = assistantRuntimes.assistantRuntimePlatform.getCodexVersion;

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

async function* createThreadEventsStream(
  events: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) {
    yield event;
  }
}

afterEach(() => {
  assistantRuntimes.assistantRuntimePlatform.findCodexBinary = originalFindCodexBinary;
  assistantRuntimes.assistantRuntimePlatform.getCodexVersion = originalGetCodexVersion;
  codexClient.__setCodexCtorForTests(null);
  if (originalCodexBackend === undefined) {
    delete process.env.MONOLITH_CODEX_BACKEND;
  } else {
    process.env.MONOLITH_CODEX_BACKEND = originalCodexBackend;
  }
  if (originalPublicCodexBackend === undefined) {
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND = originalPublicCodexBackend;
  }
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
  db.closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/chat request idempotency by client_message_id', () => {
  it('replays an existing completed assistant turn instead of calling the model again', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => '/nonexistent/codex';
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-idempotent-replay-'));
    const session = db.createSession('Replay Duplicate Turn', '', '', workspaceDir, 'code', '', 'chat', 'codex');

    db.upsertUserMessage(session.id, 'msg-replay', 'hello replay');
    const placeholder = db.createAssistantPlaceholderMessage(session.id, 'msg-replay');
    const persisted = require('../../lib/chat/assistant-terminal-persistence') as typeof import('../../lib/chat/assistant-terminal-persistence');
    persisted.persistAssistantTerminalStateDirect({
      sessionId: session.id,
      messageId: placeholder.id,
      clientMessageId: 'msg-replay',
      blocks: [
        { type: 'reasoning', text: 'cached reasoning' },
        { type: 'text', text: 'cached answer' },
      ],
      tokenUsage: {
        input_tokens: 7,
        output_tokens: 13,
      },
      terminalStatus: 'completed',
      revision: 2,
    });

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello replay',
        client_message_id: 'msg-replay',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    const events = parseSSEEvents(payload);
    assert.deepEqual(
      events.map((event) => event.type),
      ['user_persisted', 'reasoning', 'text', 'result', 'persisted'],
    );

    const persistedAck = JSON.parse(events[4]!.data) as {
      message_id: string;
      client_message_id: string;
      revision: number;
    };
    assert.equal(persistedAck.client_message_id, 'msg-replay');
    assert.equal(persistedAck.revision, 2);

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.id, placeholder.id);
    assert.equal(messages[1]?.content.includes('cached answer'), true);
    assert.equal(messages[1]?.persisted_revision, 2);
  });

  it('rejects a duplicate turn when the assistant row is still non-terminal', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => '/nonexistent/codex';
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-idempotent-inflight-'));
    const session = db.createSession('Inflight Duplicate Turn', '', '', workspaceDir, 'code', '', 'chat', 'codex');
    db.updateSessionStateRecord(session.id, {
      runtimeStatus: 'running',
      runtimeError: '',
    });

    db.upsertUserMessage(session.id, 'msg-inflight', 'hello inflight');
    const placeholder = db.createAssistantPlaceholderMessage(session.id, 'msg-inflight');
    assert.equal(placeholder.status, 'streaming');

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello inflight',
        client_message_id: 'msg-inflight',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 409);

    const json = await response.json() as {
      code: string;
      assistant_message_id: string;
      assistant_status: string | null;
    };
    assert.equal(json.code, 'DUPLICATE_CLIENT_MESSAGE_IN_PROGRESS');
    assert.equal(json.assistant_message_id, placeholder.id);
    assert.equal(json.assistant_status, 'streaming');

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.id, placeholder.id);
    assert.equal(messages[1]?.status, 'streaming');
  });

  it('retries a failed assistant turn with the same client_message_id', async () => {
    process.env.MONOLITH_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => '/nonexistent/codex';
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    class FakeCodex {
      startThread() {
        return {
          runStreamed: async () => ({
            events: createThreadEventsStream([
              { type: 'thread.started', thread_id: 'thread-retry' },
              { type: 'turn.started' },
              {
                type: 'item.completed',
                item: {
                  id: 'item_1',
                  details: { type: 'agent_message', text: 'retry answer' },
                },
              },
              { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 5 } },
            ]),
          }),
        };
      }
    }

    codexClient.__setCodexCtorForTests(FakeCodex as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-idempotent-error-retry-'));
    const session = db.createSession('Retry Failed Turn', '', '', workspaceDir, 'code', '', 'chat', 'codex');

    db.upsertUserMessage(session.id, 'msg-error', 'hello retry');
    const placeholder = db.createAssistantPlaceholderMessage(session.id, 'msg-error');
    const persisted = require('../../lib/chat/assistant-terminal-persistence') as typeof import('../../lib/chat/assistant-terminal-persistence');
    persisted.persistAssistantTerminalStateDirect({
      sessionId: session.id,
      messageId: placeholder.id,
      clientMessageId: 'msg-error',
      blocks: [
        { type: 'text', text: 'stale failed answer' },
      ],
      tokenUsage: {
        input_tokens: 1,
        output_tokens: 1,
      },
      terminalStatus: 'error',
      revision: 1,
    });

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello retry',
        client_message_id: 'msg-error',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    const events = parseSSEEvents(payload);
    assert.equal(events[0]?.type, 'user_persisted');

    const persistedAck = JSON.parse(events.at(-1)!.data) as {
      message_id: string;
      client_message_id: string;
      revision: number;
    };
    assert.equal(persistedAck.client_message_id, 'msg-error');
    assert.equal(persistedAck.message_id, placeholder.id);
    assert.equal(persistedAck.revision, 1);

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.id, placeholder.id);
    assert.equal(messages[1]?.status, 'completed');
    assert.equal(messages[1]?.persisted_revision, 1);
    assert.match(messages[1]?.content || '', /retry answer/);
    assert.doesNotMatch(messages[1]?.content || '', /stale failed answer/);

    const parts = db.getMessageParts(placeholder.id);
    assert.equal(parts.length, 1);
    assert.equal(parts[0]?.content, 'retry answer');
    assert.equal(parts[0]?.is_final, 1);
  });

  it('restarts an orphaned streaming assistant placeholder with the same client_message_id', async () => {
    process.env.MONOLITH_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => '/nonexistent/codex';
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    class FakeCodex {
      startThread() {
        return {
          runStreamed: async () => ({
            events: createThreadEventsStream([
              { type: 'thread.started', thread_id: 'thread-orphan' },
              { type: 'turn.started' },
              {
                type: 'item.completed',
                item: {
                  id: 'item_1',
                  details: { type: 'agent_message', text: 'recovered answer' },
                },
              },
              { type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 6 } },
            ]),
          }),
        };
      }
    }

    codexClient.__setCodexCtorForTests(FakeCodex as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-idempotent-orphaned-streaming-'));
    const session = db.createSession('Retry Orphaned Streaming Turn', '', '', workspaceDir, 'code', '', 'chat', 'codex');

    db.upsertUserMessage(session.id, 'msg-orphaned', 'hello orphaned');
    const placeholder = db.createAssistantPlaceholderMessage(session.id, 'msg-orphaned');
    assert.equal(placeholder.status, 'streaming');

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello orphaned',
        client_message_id: 'msg-orphaned',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    const events = parseSSEEvents(payload);
    assert.equal(events[0]?.type, 'user_persisted');

    const { messages } = db.getMessages(session.id, { limit: 10 });
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.id, placeholder.id);
    assert.equal(messages[1]?.status, 'completed');
    assert.equal((messages[1]?.content || '').trim().length > 0, true);
  });

  it('starts a fresh Codex turn when only the default model is backfilled onto an empty session model', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.MONOLITH_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
    db.setSetting('codex_default_model', 'gpt-5-codex');
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    const captured: {
      resumeCalls: number;
      startCalls: number;
      resumeInput?: unknown;
    } = {
      resumeCalls: 0,
      startCalls: 0,
    };

    async function* createThreadEventsStream(
      events: Array<Record<string, unknown>>,
    ): AsyncGenerator<Record<string, unknown>> {
      for (const event of events) {
        yield event;
      }
    }

    class FakeCodex {
      startThread() {
        captured.startCalls += 1;
        return {
          runStreamed: async () => ({
            events: createThreadEventsStream([
              { type: 'thread.started', thread_id: 'thread-default-model-started' },
              { type: 'turn.started' },
              {
                type: 'item.completed',
                item: {
                  id: 'item_1',
                  details: { type: 'agent_message', text: 'fresh turn started' },
                },
              },
              { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 4 } },
            ]),
          }),
        };
      }

      resumeThread() {
        captured.resumeCalls += 1;
        return {
          runStreamed: async (input: unknown) => {
            captured.resumeInput = input;
            return {
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'thread-existing-default-model' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                  details: { type: 'agent_message', text: 'resume should not run' },
                },
              },
              { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 4 } },
              ]),
            };
          },
        };
      }
    }

    codexClient.__setCodexCtorForTests(FakeCodex as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-default-model-resume-workspace-'));
    const session = db.createSession('Resume Default Model Backfill', '', '', workspaceDir, 'code', '', 'chat', 'codex');
    db.updateSdkSessionId(session.id, 'thread-existing-default-model');

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'continue',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 200);

    const payload = await readStringStream(response.body as ReadableStream<string> | null);
    assert.match(payload, /"type":"text","data":"fresh turn started"/);
    assert.doesNotMatch(payload, /Session fallback/);
    assert.equal(captured.resumeCalls, 0);
    assert.equal(captured.startCalls, 1);
    assert.equal(captured.resumeInput, undefined);

    const updatedSession = db.getSession(session.id)!;
    assert.equal(updatedSession.model, 'gpt-5-codex');
    assert.equal(updatedSession.sdk_session_id, 'thread-default-model-started');
  });
});
