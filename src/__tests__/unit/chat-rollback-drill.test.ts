import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CODEX_BACKEND,
  getCodexBackend,
  normalizeCodexBackend,
} from '../../lib/codex-backend';
import {
  getChatRolloutMode,
  usesBridgeCompatibilityFallbacks,
} from '../../lib/chat-rollout';

const ORIGINAL_CHAT_ROLLOUT = process.env.NOONFLOW_CHAT_ROLLOUT_MODE;
const ORIGINAL_PUBLIC_CHAT_ROLLOUT = process.env.NEXT_PUBLIC_NOONFLOW_CHAT_ROLLOUT_MODE;
const ORIGINAL_CODEX_BACKEND = process.env.NOONFLOW_CODEX_BACKEND;
const ORIGINAL_PUBLIC_CODEX_BACKEND = process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

afterEach(() => {
  if (ORIGINAL_CHAT_ROLLOUT === undefined) {
    delete process.env.NOONFLOW_CHAT_ROLLOUT_MODE;
  } else {
    process.env.NOONFLOW_CHAT_ROLLOUT_MODE = ORIGINAL_CHAT_ROLLOUT;
  }

  if (ORIGINAL_PUBLIC_CHAT_ROLLOUT === undefined) {
    delete process.env.NEXT_PUBLIC_NOONFLOW_CHAT_ROLLOUT_MODE;
  } else {
    process.env.NEXT_PUBLIC_NOONFLOW_CHAT_ROLLOUT_MODE = ORIGINAL_PUBLIC_CHAT_ROLLOUT;
  }

  if (ORIGINAL_CODEX_BACKEND === undefined) {
    delete process.env.NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NOONFLOW_CODEX_BACKEND = ORIGINAL_CODEX_BACKEND;
  }

  if (ORIGINAL_PUBLIC_CODEX_BACKEND === undefined) {
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND = ORIGINAL_PUBLIC_CODEX_BACKEND;
  }

});

describe('chat rollback drills', () => {
  it('supports rolling chat mode from canonical to bridge via env override', () => {
    process.env.NOONFLOW_CHAT_ROLLOUT_MODE = 'canonical';
    assert.equal(getChatRolloutMode(), 'canonical');
    assert.equal(usesBridgeCompatibilityFallbacks(getChatRolloutMode()), false);

    process.env.NOONFLOW_CHAT_ROLLOUT_MODE = 'bridge';
    assert.equal(getChatRolloutMode(), 'bridge');
    assert.equal(usesBridgeCompatibilityFallbacks(getChatRolloutMode()), true);
  });

  it('supports rolling chat mode from bridge to legacy via env override', () => {
    process.env.NOONFLOW_CHAT_ROLLOUT_MODE = 'bridge';
    assert.equal(getChatRolloutMode(), 'bridge');

    process.env.NOONFLOW_CHAT_ROLLOUT_MODE = 'legacy';
    assert.equal(getChatRolloutMode(), 'legacy');
    assert.equal(usesBridgeCompatibilityFallbacks(getChatRolloutMode()), true);
  });

  it('defaults invalid codex backend values to sdk-system-cli and prefers explicit env values', () => {
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    delete process.env.NOONFLOW_CODEX_BACKEND;

    assert.equal(normalizeCodexBackend(undefined), DEFAULT_CODEX_BACKEND);
    assert.equal(normalizeCodexBackend('unknown'), DEFAULT_CODEX_BACKEND);
    assert.equal(getCodexBackend(), DEFAULT_CODEX_BACKEND);

    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-bundled';
    assert.equal(getCodexBackend(), 'sdk-system-cli');

    process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    assert.equal(getCodexBackend(), 'sdk-system-cli');
  });

  it('does not expose a bundled backend or revive it through the removed enable switch', () => {
    process.env.NOONFLOW_ENABLE_CODEX_BUNDLED = 'true';
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-bundled';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    assert.equal(normalizeCodexBackend('sdk-bundled'), 'sdk-system-cli');
    assert.equal(getCodexBackend(), 'sdk-system-cli');
  });

  it('still supports rolling codex backend back to legacy-cli explicitly', () => {
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    assert.equal(getCodexBackend(), 'legacy-cli');
  });
});
