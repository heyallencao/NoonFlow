import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCodexResumeInvalidation,
  evaluateCodexResumePatchInvalidation,
} from '../../lib/codex-resume-contract';

describe('codex resume invalidation contract', () => {
  it('does not invalidate when there is no resume session id', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: '',
      effectiveMode: 'code',
      sessionMode: 'code',
    });

    assert.deepEqual(reasons, []);
  });

  it('invalidates when mode changes', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'plan',
      sessionMode: 'code',
    });

    assert.deepEqual(reasons, ['mode_changed']);
  });

  it('invalidates when system prompt is appended', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'code',
      sessionMode: 'code',
      systemPromptAppend: 'append this',
    });

    assert.deepEqual(reasons, ['system_prompt_append']);
  });

  it('invalidates when model changes', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'code',
      sessionMode: 'code',
      effectiveModel: 'gpt-5.4',
      sessionModel: 'gpt-5.3',
    });

    assert.deepEqual(reasons, ['model_changed']);
  });

  it('invalidates when sdk/work directory is missing', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'code',
      sessionMode: 'code',
      sdkCwd: '/tmp/missing-workspace',
      pathExists: () => false,
    });

    assert.deepEqual(reasons, ['cwd_missing']);
  });

  it('returns combined reasons in stable order', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'plan',
      sessionMode: 'code',
      systemPromptAppend: 'append this',
      effectiveModel: 'gpt-5.4',
      sessionModel: '',
      workingDirectory: '/tmp/missing-workspace',
      pathExists: () => false,
    });

    assert.deepEqual(reasons, [
      'mode_changed',
      'system_prompt_append',
      'session_model_missing',
      'cwd_missing',
    ]);
  });

  it('does not invalidate for whitespace append or empty model override', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'code',
      sessionMode: 'code',
      systemPromptAppend: '  ',
      effectiveModel: '',
      sessionModel: 'gpt-5.4',
      workingDirectory: '/tmp/existing-workspace',
      pathExists: () => true,
    });

    assert.deepEqual(reasons, []);
  });

  it('invalidates when session model metadata is missing but an effective model is known', () => {
    const reasons = evaluateCodexResumeInvalidation({
      resumeSessionId: 'sdk-1',
      effectiveMode: 'code',
      sessionMode: 'code',
      effectiveModel: 'gpt-5.4',
      sessionModel: '',
      workingDirectory: '/tmp/existing-workspace',
      pathExists: () => true,
    });

    assert.deepEqual(reasons, ['session_model_missing']);
  });
});

describe('codex session PATCH invalidation contract', () => {
  it('does not invalidate for non-codex runtime', () => {
    const reasons = evaluateCodexResumePatchInvalidation({
      assistantRuntime: 'claude_code',
      resumeSessionId: 'sdk-1',
      currentMode: 'code',
      patch: { mode: 'plan' },
    });

    assert.deepEqual(reasons, []);
  });

  it('does not invalidate when there is no resume session id', () => {
    const reasons = evaluateCodexResumePatchInvalidation({
      assistantRuntime: 'codex',
      resumeSessionId: '',
      currentMode: 'code',
      patch: { mode: 'plan' },
    });

    assert.deepEqual(reasons, []);
  });

  it('invalidates on model/system prompt/provider/mode/workdir/clear changes', () => {
    const reasons = evaluateCodexResumePatchInvalidation({
      assistantRuntime: 'codex',
      resumeSessionId: 'sdk-1',
      currentWorkingDirectory: '/tmp/a',
      currentMode: 'code',
      currentModel: 'gpt-5.4',
      currentProviderId: 'provider-a',
      currentSystemPrompt: 'old',
      patch: {
        working_directory: '/tmp/b',
        mode: 'plan',
        model: 'gpt-5.5',
        provider_id: 'provider-b',
        system_prompt: 'new',
        clear_messages: true,
      },
    });

    assert.deepEqual(reasons, [
      'working_directory_updated',
      'mode_updated',
      'model_updated',
      'provider_updated',
      'system_prompt_updated',
      'messages_cleared',
    ]);
  });

  it('does not invalidate when patch values are unchanged', () => {
    const reasons = evaluateCodexResumePatchInvalidation({
      assistantRuntime: 'codex',
      resumeSessionId: 'sdk-1',
      currentWorkingDirectory: '/tmp/a',
      currentMode: 'code',
      currentModel: 'gpt-5.4',
      currentProviderId: 'provider-a',
      currentSystemPrompt: 'same',
      patch: {
        working_directory: '/tmp/a',
        mode: 'code',
        model: 'gpt-5.4',
        provider_id: 'provider-a',
        system_prompt: 'same',
      },
    });

    assert.deepEqual(reasons, []);
  });
});
