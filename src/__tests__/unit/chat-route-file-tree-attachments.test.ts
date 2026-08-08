import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectUploadDir } from '../../lib/upload-paths';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-route-file-tree-attachments-'));
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

describe('/api/chat file tree attachments', () => {
  it('keeps the workspace path for the runtime while still persisting an upload copy', async () => {
    process.env.MONOLITH_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => '/nonexistent/codex';
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'test-version';

    let capturedInput: unknown;

    class FakeCodex {
      startThread() {
        return {
          runStreamed: async (input: unknown) => {
            capturedInput = input;
            return {
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'thread-file-tree-attachment' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    details: { type: 'agent_message', text: 'file attached' },
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

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-file-tree-workspace-'));
    const sourcePath = path.join(workspaceDir, 'src', 'demo.ts');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'export const demo = 1;\n', 'utf8');

    const session = db.createSession('File Tree Attachment Path', '', '', workspaceDir, 'code', '', 'chat', undefined, 'codex');

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'read this file',
        assistant_runtime: 'codex',
        files: [
          {
            id: 'file-1',
            name: 'demo.ts',
            type: 'text/plain',
            size: 22,
            data: Buffer.from('export const demo = 1;\n', 'utf8').toString('base64'),
            sourcePath,
          },
        ],
      }),
    }) as never);

    assert.equal(response.status, 200);
    await readStringStream(response.body as ReadableStream<string> | null);

    assert.equal(typeof capturedInput, 'string');
    assert.match(capturedInput as string, new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const { messages } = db.getMessages(session.id, { limit: 10 });
    const userMessage = messages.find((message: { role: string }) => message.role === 'user');
    assert.ok(userMessage);

    const filesMatch = userMessage.content.match(/^<!--files:(.*?)-->/);
    assert.ok(filesMatch);

    const persistedFiles = JSON.parse(filesMatch[1]) as Array<{
      filePath: string;
      sourcePath?: string;
    }>;
    assert.equal(persistedFiles[0]?.sourcePath, sourcePath);
    assert.equal(path.dirname(persistedFiles[0]?.filePath ?? ''), getProjectUploadDir(workspaceDir));
    assert.notEqual(persistedFiles[0]?.filePath, sourcePath);
  });
});
