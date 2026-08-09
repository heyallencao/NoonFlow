import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectUploadDir } from '../../lib/upload-paths';
import { installFakeCodexCli, readFakeCodexRequests } from './helpers/fake-codex-cli';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-route-file-tree-attachments-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));
const originalHome = process.env.HOME;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalCodexBackend = process.env.MONOLITH_CODEX_BACKEND;
const originalPublicCodexBackend = process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
const fakeCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-file-route-codex-'));
const fakeCodex = installFakeCodexCli(fakeCodexHome);

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/route') as typeof import('../../app/api/chat/route');
const assistantRuntimes = require('../../lib/assistant-runtimes') as typeof import('../../lib/assistant-runtimes');
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

afterEach(() => {
  delete process.env.FAKE_CODEX_CAPTURE;
  delete process.env.FAKE_CODEX_SCENARIO;
  assistantRuntimes.assistantRuntimePlatform.findCodexBinary = originalFindCodexBinary;
  assistantRuntimes.assistantRuntimePlatform.getCodexVersion = originalGetCodexVersion;
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
  fs.rmSync(fakeCodexHome, { recursive: true, force: true });
});

describe('/api/chat file tree attachments', () => {
  it('keeps the workspace path for the runtime while still persisting an upload copy', async () => {
    process.env.MONOLITH_CODEX_BACKEND = 'app-server';
    delete process.env.NEXT_PUBLIC_MONOLITH_CODEX_BACKEND;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.HOME = fakeCodexHome;
    process.env.FAKE_CODEX_CAPTURE = fakeCodex.capturePath;
    fs.rmSync(fakeCodex.capturePath, { force: true });
    assistantRuntimes.assistantRuntimePlatform.findCodexBinary = () => fakeCodex.binaryPath;
    assistantRuntimes.assistantRuntimePlatform.getCodexVersion = async () => 'codex-cli 0.145.0';
    const { clearShellEnvCache } = await import('../../lib/environment');
    clearShellEnvCache();

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-file-tree-workspace-'));
    const sourcePath = path.join(workspaceDir, 'src', 'demo.ts');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'export const demo = 1;\n', 'utf8');

    const session = db.createSession('File Tree Attachment Path', '', '', workspaceDir, 'code', '', 'chat', 'codex');

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

    const turnStart = readFakeCodexRequests(fakeCodex.capturePath)
      .find((entry) => entry.method === 'turn/start') as { params?: { input?: Array<{ text?: string }> } };
    assert.match(turnStart.params?.input?.[0]?.text || '', new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

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
