import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pickPreferredWorktreeSessionId } from '../../lib/worktree-session-preference';

describe('worktree session preference', () => {
  it('prefers the remembered active session over open tab ordering', () => {
    assert.equal(
      pickPreferredWorktreeSessionId({
        candidateSessionIds: ['session-a', 'session-b', 'session-c'],
        openTabIds: ['session-a', 'session-c'],
        rememberedSessionId: 'session-b',
      }),
      'session-b',
    );
  });

  it('falls back to the newest open tab when there is no remembered session', () => {
    assert.equal(
      pickPreferredWorktreeSessionId({
        candidateSessionIds: ['session-a', 'session-b', 'session-c'],
        openTabIds: ['session-a', 'session-c'],
        rememberedSessionId: null,
      }),
      'session-c',
    );
  });

  it('ignores remembered sessions that are not part of the current worktree', () => {
    assert.equal(
      pickPreferredWorktreeSessionId({
        candidateSessionIds: ['session-a', 'session-b'],
        openTabIds: ['session-a', 'session-b'],
        rememberedSessionId: 'session-x',
      }),
      'session-b',
    );
  });
});
