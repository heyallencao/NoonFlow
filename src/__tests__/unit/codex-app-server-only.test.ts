import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('codex app-server only backend', () => {
  it('removes the former alternate backend implementation', () => {
    assert.equal(fs.existsSync(path.resolve('src/lib/codex/legacy-cli.ts')), false);
    assert.equal(fs.existsSync(path.resolve('src/lib/codex-backend.ts')), false);
  });

  it('hard-wires the route diagnostic to app-server', () => {
    const source = fs.readFileSync(path.resolve('src/app/api/chat/route.ts'), 'utf8');
    assert.match(source, /codex_backend:\s*effectiveRuntime === 'codex' \? 'app-server' : null/);
    assert.doesNotMatch(source, /getCodexBackend|NOONFLOW_CODEX_BACKEND/);
  });

  it('contains no alternate backend branch in the Codex client', () => {
    const source = fs.readFileSync(path.resolve('src/lib/codex-client.ts'), 'utf8');
    assert.doesNotMatch(source, /runLegacyAttempt|buildLegacyCodexArgs|getCodexBackend/);
    assert.match(source, /runAppServerAttempt/);
  });
});
