import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultContextSize,
  parseContextWindowOverrides,
  resolveContextWindowSize,
} from '../../lib/default-context-sizes';

describe('default context sizes', () => {
  it('uses current GPT-5 and Codex defaults for common session model names', () => {
    assert.equal(getDefaultContextSize('gpt-5'), 400_000);
    assert.equal(getDefaultContextSize('gpt-5.4'), 1_050_000);
    assert.equal(getDefaultContextSize('gpt-5.4-pro'), 1_050_000);
    assert.equal(getDefaultContextSize('gpt-5.4-mini'), 400_000);
    assert.equal(getDefaultContextSize('gpt-5.3-codex'), 400_000);
    assert.equal(getDefaultContextSize('gpt-5-codex'), 400_000);
    assert.equal(getDefaultContextSize('gpt-5.2-codex'), 400_000);
  });

  it('prefers the most specific prefix match', () => {
    assert.equal(getDefaultContextSize('gpt-5-chat-latest'), 128_000);
    assert.equal(getDefaultContextSize('gpt-5.4-xhigh'), 1_050_000);
    assert.equal(getDefaultContextSize('anthropic/claude-opus-4-6'), 200_000);
    assert.equal(getDefaultContextSize('MiniMax-M2.7-highspeed'), 204_800);
  });

  it('ignores invalid override values and resolves valid ones', () => {
    const overrides = parseContextWindowOverrides('{"gpt-5": 500000, "broken": -1, "bad":"nope"}');

    assert.deepEqual(overrides, { 'gpt-5': 500_000 });
    assert.equal(resolveContextWindowSize('gpt-5.4', overrides), 500_000);
    assert.equal(resolveContextWindowSize('sonnet', overrides), 1_000_000);
  });

  it('does not let a more specific override remap a broader model name', () => {
    const overrides = parseContextWindowOverrides('{"gpt-5.4-mini": 123456}');

    assert.equal(resolveContextWindowSize('gpt-5.4', overrides), 1_050_000);
    assert.equal(resolveContextWindowSize('gpt-5.4-mini-preview', overrides), 123_456);
  });

  it('uses provider label hints to resolve generic aliases to the right context size', () => {
    assert.equal(getDefaultContextSize('sonnet', 'Sonnet 4.6'), 1_000_000);
    assert.equal(getDefaultContextSize('opus', 'Opus 4.6'), 200_000);
    assert.equal(getDefaultContextSize('sonnet', 'Kimi K2.5'), 2_000_000);
    assert.equal(getDefaultContextSize('haiku', 'GLM-4.5-Air'), 204_800);
  });

  it('does not let a mismatched label override an explicit model id', () => {
    assert.equal(getDefaultContextSize('gpt-5.4', 'Claude 4.6 Opus'), 1_050_000);
    assert.equal(resolveContextWindowSize('gpt-5.4', {}, 'Claude 4.6 Opus'), 1_050_000);
  });

  it('still lets an exact override on the visible model name win over label-based defaults', () => {
    const overrides = parseContextWindowOverrides('{"sonnet":111111,"kimi-k2.5":222222}');

    assert.equal(resolveContextWindowSize('sonnet', overrides, 'Kimi K2.5'), 111_111);
    assert.equal(resolveContextWindowSize('opus', overrides, 'Opus 4.6'), 200_000);
  });
});
