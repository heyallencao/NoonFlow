import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getChatRolloutMode,
  usesBridgeCompatibilityFallbacks,
} from '../../lib/chat-rollout';

const ORIGINAL_CHAT_ROLLOUT = process.env.NOONFLOW_CHAT_ROLLOUT_MODE;
const ORIGINAL_PUBLIC_CHAT_ROLLOUT = process.env.NEXT_PUBLIC_NOONFLOW_CHAT_ROLLOUT_MODE;

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

  it('has no Codex backend selector to roll back through', () => {
    assert.equal(fs.existsSync(path.resolve('src/lib/codex-backend.ts')), false);
  });

  it('does not read a Codex backend environment switch in the production path', () => {
    const clientSource = fs.readFileSync(path.resolve('src/lib/codex-client.ts'), 'utf8');
    const routeSource = fs.readFileSync(path.resolve('src/app/api/chat/route.ts'), 'utf8');
    assert.doesNotMatch(`${clientSource}\n${routeSource}`, /NOONFLOW_CODEX_BACKEND|MONOLITH_CODEX_BACKEND/);
  });

  it('keeps app-server as the sole Codex production path', () => {
    const clientSource = fs.readFileSync(path.resolve('src/lib/codex-client.ts'), 'utf8');
    const routeSource = fs.readFileSync(path.resolve('src/app/api/chat/route.ts'), 'utf8');
    assert.match(clientSource, /runAppServerAttempt/);
    assert.match(routeSource, /codex_backend:\s*effectiveRuntime === 'codex' \? 'app-server' : null/);
  });
});
