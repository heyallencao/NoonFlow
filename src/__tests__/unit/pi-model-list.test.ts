import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parsePiModelListOutput } from '../../lib/platform';

describe('parsePiModelListOutput', () => {
  it('preserves provider-scoped ids and parses capabilities', () => {
    const models = parsePiModelListOutput(`
provider    model                 context    max-out    thinking    images
anthropic   claude-sonnet-4       200K       64K        yes         yes
openai      gpt-5                 1M         128K       yes         no
openrouter  claude-sonnet-4       200K       32K        no          yes
`);

    assert.equal(models.length, 3);
    assert.equal(models[0].value, 'anthropic/claude-sonnet-4');
    assert.equal(models[0].contextWindow, 200_000);
    assert.equal(models[0].maxOutputTokens, 64_000);
    assert.equal(models[0].reasoning, true);
    assert.equal(models[1].contextWindow, 1_000_000);
    assert.equal(models[2].value, 'openrouter/claude-sonnet-4');
  });

  it('returns an empty catalog for native no-model output', () => {
    assert.deepEqual(parsePiModelListOutput('No models available. Configure authentication first.'), []);
  });
});
