import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-chat-session-route-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.writeFileSync(path.join(tmpDir, 'monolith.db'), '');

let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getSession: typeof import('../../lib/db').getSession;
let updateSdkSessionId: typeof import('../../lib/db').updateSdkSessionId;
let patchSession: typeof import('../../app/api/chat/sessions/[id]/route').PATCH;

before(async () => {
  ({ closeDb, createSession, getSession, updateSdkSessionId } = await import('../../lib/db'));
  ({ PATCH: patchSession } = await import('../../app/api/chat/sessions/[id]/route'));
});

afterEach(() => {
  closeDb();
});

describe('/api/chat/sessions/[id] PATCH', () => {
  it('clears Codex resume id when model changes', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-session-workspace-'));
    const session = createSession(
      'Codex Session',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    updateSdkSessionId(session.id, 'codex-thread-1');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5-codex-high' }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 200);
    const updated = getSession(session.id)!;
    assert.equal(updated.model, 'gpt-5-codex-high');
    assert.equal(updated.sdk_session_id, '');
  });

  it('updates system_prompt and invalidates Codex resume id', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-system-prompt-workspace-'));
    const session = createSession(
      'Codex Prompt Session',
      'gpt-5-codex',
      'old rules',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    updateSdkSessionId(session.id, 'codex-thread-2');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: 'new rules' }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 200);
    const updated = getSession(session.id)!;
    assert.equal(updated.system_prompt, 'new rules');
    assert.equal(updated.sdk_session_id, '');
  });

  it('invalidates Codex resume id when provider changes', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-provider-workspace-'));
    const session = createSession(
      'Codex Provider Session',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      'provider-a',
      'chat',
      'codex',
    );
    updateSdkSessionId(session.id, 'codex-thread-3');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'provider-b' }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 200);
    const updated = getSession(session.id)!;
    assert.equal(updated.provider_id, 'provider-b');
    assert.equal(updated.sdk_session_id, '');
  });

  it('does not invalidate non-codex resume id when model changes', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-claude-session-workspace-'));
    const session = createSession(
      'Claude Session',
      'sonnet',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'claude_code',
    );
    updateSdkSessionId(session.id, 'claude-thread-1');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonnet-4' }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 200);
    const updated = getSession(session.id)!;
    assert.equal(updated.model, 'sonnet-4');
    assert.equal(updated.sdk_session_id, 'claude-thread-1');
  });

  it('supports clearing working_directory and invalidates Codex resume id', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-clear-workdir-'));
    const session = createSession(
      'Codex Clear Workdir Session',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    updateSdkSessionId(session.id, 'codex-thread-clear-workdir');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ working_directory: '' }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 200);
    const updated = getSession(session.id)!;
    assert.equal(updated.working_directory, '');
    assert.equal(updated.sdk_cwd, '');
    assert.equal(updated.sdk_session_id, '');
  });

  it('rejects non-string PATCH fields with a 400 response', async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-invalid-patch-'));
    const session = createSession(
      'Codex Invalid Patch Session',
      'gpt-5-codex',
      '',
      workspaceDir,
      'code',
      '',
      'chat',
      'codex',
    );
    updateSdkSessionId(session.id, 'codex-thread-invalid-patch');

    const response = await patchSession(new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ working_directory: null }),
    }) as never, { params: Promise.resolve({ id: session.id }) });

    assert.equal(response.status, 400);
    const payload = await response.json() as { error?: string };
    assert.equal(payload.error, '"working_directory" must be a string');

    const updated = getSession(session.id)!;
    assert.equal(updated.working_directory, workspaceDir);
    assert.equal(updated.sdk_session_id, 'codex-thread-invalid-patch');
  });
});
