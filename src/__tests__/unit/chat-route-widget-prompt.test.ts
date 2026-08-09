import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-route-widget-prompt-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const db = require('../../lib/db') as typeof import('../../lib/db');
const route = require('../../app/api/chat/route') as typeof import('../../app/api/chat/route');
const settingsRoute = require('../../app/api/settings/app/route') as typeof import('../../app/api/settings/app/route');
const claudeClient = require('../../lib/claude-client') as typeof import('../../lib/claude-client');
const assistantRuntimes = require('../../lib/assistant-runtimes') as typeof import('../../lib/assistant-runtimes');

const originalFindClaudeBinary = assistantRuntimes.assistantRuntimePlatform.findClaudeBinary;
const originalGetClaudeVersion = assistantRuntimes.assistantRuntimePlatform.getClaudeVersion;

function mockClaudeStream(): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      const events = [
        { type: 'text', data: 'mocked response' },
        { type: 'result', data: JSON.stringify({ input_tokens: 3, output_tokens: 7 }) },
        { type: 'done', data: '' },
      ];
      for (const event of events) {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      }
      controller.close();
    },
  });
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
  claudeClient.__resetStreamClaudeTestOverrides();
  assistantRuntimes.assistantRuntimePlatform.findClaudeBinary = originalFindClaudeBinary;
  assistantRuntimes.assistantRuntimePlatform.getClaudeVersion = originalGetClaudeVersion;
  db.closeDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/chat widget prompt injection', () => {
  it('injects widget system prompt when setting is enabled and request has visualization intent', async () => {
    assistantRuntimes.assistantRuntimePlatform.findClaudeBinary = () => '/usr/local/bin/claude';
    assistantRuntimes.assistantRuntimePlatform.getClaudeVersion = async () => 'test-version';

    await settingsRoute.PUT(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          assistant_runtime_enabled_claude_code: 'true',
          anthropic_auth_token: 'test-token',
          generative_ui_enabled: 'true',
        },
      }),
    }) as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-widget-route-enabled-'));
    const session = db.createSession(
      'Widget Prompt Enabled',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'claude_code',
    );
    let capturedSystemPrompt: string | undefined;
    let capturedGenerativeUI: boolean | undefined;
    claudeClient.__setStreamClaudeForTests((options: import('../../types').ClaudeStreamOptions) => {
      capturedSystemPrompt = options.systemPrompt;
      capturedGenerativeUI = options.generativeUI;
      return mockClaudeStream();
    }, session.id);

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'Please create a colorful chart for this dataset.',
      }),
    }) as never);

    assert.equal(response.status, 200);
    await readStringStream(response.body as ReadableStream<string> | null);
    assert.equal(capturedGenerativeUI, true);
    assert.equal((capturedSystemPrompt || '').includes('```show-widget'), true);
  });

  it('does not inject widget system prompt when setting is disabled', async () => {
    assistantRuntimes.assistantRuntimePlatform.findClaudeBinary = () => '/usr/local/bin/claude';
    assistantRuntimes.assistantRuntimePlatform.getClaudeVersion = async () => 'test-version';

    await settingsRoute.PUT(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          assistant_runtime_enabled_claude_code: 'true',
          anthropic_auth_token: 'test-token',
          generative_ui_enabled: 'false',
        },
      }),
    }) as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-widget-route-disabled-'));
    const session = db.createSession(
      'Widget Prompt Disabled',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'claude_code',
    );
    let capturedSystemPrompt: string | undefined;
    let capturedGenerativeUI: boolean | undefined;
    claudeClient.__setStreamClaudeForTests((options: import('../../types').ClaudeStreamOptions) => {
      capturedSystemPrompt = options.systemPrompt;
      capturedGenerativeUI = options.generativeUI;
      return mockClaudeStream();
    }, session.id);

    const response = await route.POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'Please create a colorful chart for this dataset.',
      }),
    }) as never);

    assert.equal(response.status, 200);
    await readStringStream(response.body as ReadableStream<string> | null);
    assert.equal(capturedGenerativeUI, false);
    assert.equal((capturedSystemPrompt || '').includes('```show-widget'), false);
  });
});
