import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildLegacyCodexArgs } from '../../lib/codex/legacy-cli';

describe('codex legacy cli args', () => {
  it('builds non-resume args with full-auto by default', () => {
    const args = buildLegacyCodexArgs({
      cwd: '/tmp/workspace',
      prompt: 'hello',
      skipPermissions: false,
      imagePaths: ['/tmp/a.jpg'],
    });

    assert.deepEqual(args.slice(0, 9), [
      'exec',
      '--color',
      'never',
      '--cd',
      '/tmp/workspace',
      '--json',
      '--skip-git-repo-check',
      '--full-auto',
      '--image',
    ]);
    assert.equal(args[9], '/tmp/a.jpg');
    assert.equal(args.at(-2), '--');
    assert.equal(args.at(-1), 'hello');
  });

  it('uses plan sandbox flags when permission mode is plan', () => {
    const args = buildLegacyCodexArgs({
      cwd: '/tmp/workspace',
      prompt: 'plan',
      permissionMode: 'plan',
      skipPermissions: false,
      imagePaths: [],
    });

    assert.ok(args.includes('--sandbox'));
    assert.ok(args.includes('read-only'));
    assert.ok(!args.includes('--full-auto'));
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  });

  it('builds resume args with session id and model config', () => {
    const args = buildLegacyCodexArgs({
      cwd: '/tmp/workspace',
      prompt: 'new turn',
      skipPermissions: true,
      resolvedModel: 'gpt-5.4',
      resolvedReasoningEffort: 'xhigh',
      imagePaths: ['/tmp/b.jpg'],
      resumeSessionId: 'thread-1',
    });

    assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('gpt-5.4'));
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('model_reasoning_effort=xhigh'));
    assert.ok(args.includes('resume'));
    assert.deepEqual(args.slice(-3), ['--', 'thread-1', 'new turn']);
  });
});
