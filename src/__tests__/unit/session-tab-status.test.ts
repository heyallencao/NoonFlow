import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSessionTabExecutionStatus } from '../../lib/session-tab-status';

describe('session tab status', () => {
  it('keeps recovery reminders visible when the session is back to idle', () => {
    const status = resolveSessionTabExecutionStatus({
      runtime: {
        status: 'idle',
        error: 'Previous run was interrupted. Continue by sending a follow-up message.',
      },
    });

    assert.equal(status, 'error');
  });

  it('treats recovered permission waits with errors as attention-needed', () => {
    const status = resolveSessionTabExecutionStatus({
      snapshot: {
        phase: 'active',
        pendingPermission: {
          permissionRequestId: 'perm-1',
          toolName: 'Read',
          toolInput: {},
          toolUseId: 'tool-1',
        },
        permissionResolved: null,
        error: 'Permission request recovered from the database. Resolving it will require restarting the interrupted run.',
      },
    });

    assert.equal(status, 'error');
  });

  it('does not treat stale snapshot errors from a finished run as active failures', () => {
    const status = resolveSessionTabExecutionStatus({
      snapshot: {
        phase: 'completed',
        pendingPermission: null,
        permissionResolved: null,
        error: 'Old error that should not stick after completion.',
      },
    });

    assert.equal(status, 'ready');
  });

  it('keeps active runs as running even if the stored error field is stale', () => {
    const status = resolveSessionTabExecutionStatus({
      runtime: {
        status: 'running',
        error: 'Old retry error',
      },
    });

    assert.equal(status, 'running');
  });
});
