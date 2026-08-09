import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let postSkillSearch: typeof import('../../app/api/skills/search/route').POST;
let setSkillSearchRunner: typeof import('../../lib/claude/skill-search').__setClaudeSkillSearchRunnerForTests;

function buildRequest(model?: string): Request {
  return new Request('http://localhost/api/skills/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'review',
      skills: [{ name: 'code-review', description: 'Review code' }],
      ...(model ? { model } : {}),
    }),
  });
}

before(async () => {
  ({ POST: postSkillSearch } = await import('../../app/api/skills/search/route'));
  ({ __setClaudeSkillSearchRunnerForTests: setSkillSearchRunner } = await import('../../lib/claude/skill-search'));
});

after(() => {
  setSkillSearchRunner(null);
});

describe('skill search model source', () => {
  it('omits the model so Claude Code uses its native default', async () => {
    let receivedModel: string | undefined = 'not-called';
    setSkillSearchRunner(async ({ model }) => {
      receivedModel = model;
      return '["code-review"]';
    });

    const response = await postSkillSearch(buildRequest());
    const payload = await response.json() as { suggestions: string[] };

    assert.equal(receivedModel, undefined);
    assert.deepEqual(payload.suggestions, ['code-review']);
  });

  it('passes future CLI model identifiers through without a version map', async () => {
    let receivedModel: string | undefined;
    setSkillSearchRunner(async ({ model }) => {
      receivedModel = model;
      return '["code-review"]';
    });

    await postSkillSearch(buildRequest('future-claude-model'));

    assert.equal(receivedModel, 'future-claude-model');
  });

  it('contains no static Claude version map or implicit Pi default hydration', () => {
    const routeSource = fs.readFileSync(path.resolve('src/app/api/skills/search/route.ts'), 'utf8');
    const popoverSource = fs.readFileSync(path.resolve('src/components/chat/message-input/hooks/use-popover-controller.ts'), 'utf8');
    const settingsSource = fs.readFileSync(path.resolve('src/components/settings/ModelProviderSection.tsx'), 'utf8');

    assert.doesNotMatch(routeSource, /MODEL_MAP|claude-(?:sonnet|opus|haiku)-\d/);
    assert.doesNotMatch(popoverSource, /modelName\s*\|\|\s*['"]haiku['"]/);
    assert.doesNotMatch(settingsSource, /setPiDefaultModel\(piModelsQuery\.data\.default_model\)/);
  });
});
