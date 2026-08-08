import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-assistant-runtime-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getSetting: typeof import('../../lib/db').getSetting;
let getMessages: typeof import('../../lib/db').getMessages;
let getAllProviders: typeof import('../../lib/db').getAllProviders;
let deleteProvider: typeof import('../../lib/db').deleteProvider;
let chatPost: typeof import('../../app/api/chat/route').POST;
let sessionsPost: typeof import('../../app/api/chat/sessions/route').POST;
let getAppSettings: typeof import('../../app/api/settings/app/route').GET;
let putAppSettings: typeof import('../../app/api/settings/app/route').PUT;
let getAssistantRuntimeStatus: typeof import('../../lib/assistant-runtimes').getAssistantRuntimeStatus;
let assistantRuntimePlatform: typeof import('../../lib/assistant-runtimes').assistantRuntimePlatform;

before(async () => {
  ({ closeDb, createSession, getSetting, getMessages, getAllProviders, deleteProvider } = await import('../../lib/db'));
  ({ POST: chatPost } = await import('../../app/api/chat/route'));
  ({ POST: sessionsPost } = await import('../../app/api/chat/sessions/route'));
  ({ GET: getAppSettings, PUT: putAppSettings } = await import('../../app/api/settings/app/route'));
  ({ getAssistantRuntimeStatus, assistantRuntimePlatform } = await import('../../lib/assistant-runtimes'));
});

afterEach(() => {
  closeDb();
});

describe('assistant runtime settings route', () => {
  it('persists context window overrides in app settings', async () => {
    const saveResponse = await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          context_window_overrides: '{"gpt-5":400000,"sonnet":200000}',
        },
      }),
    }) as never);

    assert.equal(saveResponse.status, 200);
    assert.equal(getSetting('context_window_overrides'), '{"gpt-5":400000,"sonnet":200000}');

    const response = await getAppSettings();
    const json = await response.json();
    assert.equal(json.settings.context_window_overrides, '{"gpt-5":400000,"sonnet":200000}');
  });

  it('persists context usage bar toggle in app settings', async () => {
    const saveResponse = await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          context_usage_bar_enabled: 'false',
        },
      }),
    }) as never);

    assert.equal(saveResponse.status, 200);
    assert.equal(getSetting('context_usage_bar_enabled'), 'false');

    const response = await getAppSettings();
    const json = await response.json();
    assert.equal(json.settings.context_usage_bar_enabled, 'false');
  });

  it('persists explicit skip-permissions false state', async () => {
    const saveResponse = await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          dangerously_skip_permissions: 'false',
        },
      }),
    }) as never);

    assert.equal(saveResponse.status, 200);
    assert.equal(getSetting('dangerously_skip_permissions'), 'false');

    const response = await getAppSettings();
    const json = await response.json();
    assert.equal(json.settings.dangerously_skip_permissions, 'false');
  });

  it('masks Codex API key when reading app settings', async () => {
    const saveResponse = await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          codex_auth_token: 'test-codex-token-12345678',
          default_assistant_runtime: 'codex',
        },
      }),
    }) as never);

    assert.equal(saveResponse.status, 200);
    const response = await getAppSettings();
    const json = await response.json();
    assert.equal(json.settings.default_assistant_runtime, 'codex');
    assert.match(json.settings.codex_auth_token, /^\*\*\*/);
  });

  it('does not overwrite Codex API key when masked value is sent back', async () => {
    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          codex_auth_token: 'test-codex-token-original-12345678',
        },
      }),
    }) as never);

    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          codex_auth_token: '***345678',
        },
      }),
    }) as never);

    assert.equal(getSetting('codex_auth_token'), 'test-codex-token-original-12345678');
  });

  it('persists assistant auth modes in app settings', async () => {
    const saveResponse = await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          claude_auth_mode: 'login',
          codex_auth_mode: 'api_key',
        },
      }),
    }) as never);

    assert.equal(saveResponse.status, 200);
    assert.equal(getSetting('claude_auth_mode'), 'login');
    assert.equal(getSetting('codex_auth_mode'), 'api_key');

    const response = await getAppSettings();
    const json = await response.json();
    assert.equal(json.settings.claude_auth_mode, 'login');
    assert.equal(json.settings.codex_auth_mode, 'api_key');
  });
});

describe('/api/chat assistant runtime routing', () => {
  it('returns 503 when Codex runtime is selected but unavailable', async () => {
    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          assistant_runtime_enabled_codex: 'false',
        },
      }),
    }) as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-assistant-runtime-workspace-'));
    const session = createSession(
      'Codex Session',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      undefined,
      'codex',
    );

    const response = await chatPost(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello from codex',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 503);
    const json = await response.json();
    assert.equal(json.code, 'ASSISTANT_RUNTIME_UNAVAILABLE');
    assert.equal(json.assistant_runtime, 'codex');
  });

  it('does not persist the user prompt or leave the session busy when runtime is unavailable', async () => {
    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          assistant_runtime_enabled_codex: 'false',
        },
      }),
    }) as never);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-unavailable-runtime-workspace-'));
    const session = createSession(
      'Unavailable Codex Session',
      '',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      undefined,
      'codex',
    );

    const requestBody = {
      session_id: session.id,
      content: 'hello from codex with attachment',
      assistant_runtime: 'codex' as const,
      files: [{
        id: 'file-1',
        name: 'note.txt',
        type: 'text/plain',
        size: 5,
        data: Buffer.from('hello').toString('base64'),
      }],
    };

    const firstResponse = await chatPost(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }) as never);

    assert.equal(firstResponse.status, 503);
    assert.equal(getMessages(session.id, { limit: 10 }).messages.length, 0);
    assert.equal(fs.existsSync(path.join(workspaceDir, '.monolith-uploads')), false);

    const secondResponse = await chatPost(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }) as never);

    assert.equal(secondResponse.status, 503);
    const secondJson = await secondResponse.json();
    assert.equal(secondJson.code, 'ASSISTANT_RUNTIME_UNAVAILABLE');
  });

  it('creates terminal sessions even when a stale Codex preference is unavailable', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-terminal-runtime-workspace-'));

    const response = await sessionsPost(new Request('http://localhost/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        working_directory: workspaceDir,
        session_type: 'terminal',
        assistant_runtime: 'codex',
      }),
    }) as never);

    assert.equal(response.status, 201);
    const json = await response.json();
    assert.equal(json.session.session_type, 'terminal');
  });

  it('preserves Claude model/provider when runtime is not explicitly set and fallback selects Claude', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-claude-fallback-workspace-'));

    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          default_assistant_runtime: 'codex',
          assistant_runtime_enabled_claude: 'true',
          assistant_runtime_enabled_codex: 'false',
          anthropic_auth_token: 'test-claude-token',
        },
      }),
    }) as never);

    const response = await sessionsPost(new Request('http://localhost/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        working_directory: workspaceDir,
        model: 'sonnet',
        provider_id: 'env',
      }),
    }) as never);

    assert.equal(response.status, 201);
    const json = await response.json();
    assert.equal(json.session.assistant_runtime, 'claude_code');
    assert.equal(json.session.model, 'sonnet');
    assert.equal(json.session.provider_id, 'env');
  });

  it('rejects explicit Codex session creation instead of silently falling back', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-explicit-codex-workspace-'));

    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          assistant_runtime_enabled_codex: 'false',
        },
      }),
    }) as never);

    const response = await sessionsPost(new Request('http://localhost/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        working_directory: workspaceDir,
        assistant_runtime: 'codex',
        model: 'sonnet',
        provider_id: 'env',
      }),
    }) as never);

    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(json.code, 'ASSISTANT_RUNTIME_UNAVAILABLE');
  });

  it('does not report Claude as available when credentials are missing', async () => {
    const originalClaudeBinary = assistantRuntimePlatform.findClaudeBinary;
    const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    assistantRuntimePlatform.findClaudeBinary = () => '/usr/local/bin/claude';

    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          claude_auth_mode: 'api_key',
          assistant_runtime_enabled_claude: 'true',
          anthropic_auth_token: '',
          anthropic_base_url: '',
        },
      }),
    }) as never);

    for (const provider of getAllProviders()) {
      deleteProvider(provider.id);
    }

    try {
      const status = await getAssistantRuntimeStatus('claude_code');
      assert.equal(status?.installed, true);
      assert.equal(status?.configured, false);
      assert.equal(status?.available, false);
      assert.match(status?.status_message || '', /configure claude provider|anthropic auth token/i);
    } finally {
      assistantRuntimePlatform.findClaudeBinary = originalClaudeBinary;
      if (originalAnthropicApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
      }
      if (originalAnthropicAuthToken === undefined) {
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      } else {
        process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
      }
    }
  });

  it('reports Claude as available when CLI login files exist in login mode', async () => {
    const originalClaudeBinary = assistantRuntimePlatform.findClaudeBinary;
    const originalHome = process.env.HOME;
    const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const originalAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-claude-login-home-'));
    const claudeDir = path.join(testHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, '.credentials.json'), '{"user":"test"}', 'utf-8');

    assistantRuntimePlatform.findClaudeBinary = () => '/usr/local/bin/claude';
    process.env.HOME = testHome;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;

    await putAppSettings(new Request('http://localhost/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          claude_auth_mode: 'login',
          anthropic_auth_token: '',
          anthropic_base_url: '',
        },
      }),
    }) as never);

    for (const provider of getAllProviders()) {
      deleteProvider(provider.id);
    }

    try {
      const status = await getAssistantRuntimeStatus('claude_code');
      assert.equal(status?.installed, true);
      assert.equal(status?.configured, true);
      assert.equal(status?.available, true);
    } finally {
      assistantRuntimePlatform.findClaudeBinary = originalClaudeBinary;
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalAnthropicApiKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
      }
      if (originalAnthropicAuthToken === undefined) {
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      } else {
        process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
      }
      if (originalAnthropicBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        process.env.ANTHROPIC_BASE_URL = originalAnthropicBaseUrl;
      }
    }
  });
});
