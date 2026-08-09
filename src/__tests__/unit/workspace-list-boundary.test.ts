import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildWorkspaceList } from '../../lib/workspace-utils';
import type { ChatSession } from '../../types';

function session(id: string, workingDirectory: string): ChatSession {
  return {
    id,
    title: id,
    created_at: '2026-08-08T00:00:00.000Z',
    updated_at: '2026-08-08T00:00:00.000Z',
    session_type: 'chat',
    model: '',
    system_prompt: '',
    working_directory: workingDirectory,
    sdk_session_id: id,
    project_name: workingDirectory.split('/').pop() || '',
    status: 'active',
    mode: 'code',
    needs_approval: false,
    provider_name: '',
    provider_id: '',
    sdk_cwd: workingDirectory,
    runtime_status: 'idle',
    runtime_updated_at: '2026-08-08T00:00:00.000Z',
    runtime_error: '',
    assistant_runtime: 'codex',
    assistant_runtime_version: '',
  };
}

describe('NoonFlow workspace boundary', () => {
  it('never creates workspace entries from native Claude, Codex, or Pi sessions', () => {
    const opened = '/workspace/opened-in-noonflow';
    const external = '/workspace/external-native-session';
    const result = buildWorkspaceList({
      workspaces: [opened],
      sessions: [session('opened', opened), session('external', external)],
    });

    assert.deepEqual(result.map((workspace) => workspace.path), [opened]);
    assert.equal(result[0].sessionCount, 1);
  });
});
