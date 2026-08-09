import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { query } from '@anthropic-ai/claude-agent-sdk';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-claude-skill-search-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let closeDb: typeof import('../../lib/db').closeDb;
let runClaudeSkillSearch: typeof import('../../lib/claude/skill-search').runClaudeSkillSearch;
let setQueryFactory: typeof import('../../lib/claude/skill-search').__setClaudeSkillSearchQueryForTests;
let setClaudePathResolver: typeof import('../../lib/claude-client/env').__setClaudePathResolverForTests;
let capturedOptions: Options | undefined;

function createFakeQuery(): typeof query {
  return ((params: { options?: Options }) => {
    capturedOptions = params.options;
    const iterator = (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '["code-review"]',
      } as SDKMessage;
    })();
    return Object.assign(iterator, { close() {} });
  }) as unknown as typeof query;
}

before(async () => {
  ({ closeDb } = await import('../../lib/db'));
  ({ __setClaudePathResolverForTests: setClaudePathResolver } = await import('../../lib/claude-client/env'));
  ({
    runClaudeSkillSearch,
    __setClaudeSkillSearchQueryForTests: setQueryFactory,
  } = await import('../../lib/claude/skill-search'));
  setClaudePathResolver(() => '/tmp/fake-claude');
  setQueryFactory(createFakeQuery());
});

after(() => {
  setQueryFactory(null);
  setClaudePathResolver(null);
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Claude CLI skill search', () => {
  it('lets the CLI choose its default when no model override is provided', async () => {
    capturedOptions = undefined;
    const result = await runClaudeSkillSearch({
      prompt: 'Find a review skill',
      systemPrompt: 'Return JSON',
    });

    const options = capturedOptions as Options | undefined;
    assert.ok(options);
    assert.equal(result, '["code-review"]');
    assert.equal(options.model, undefined);
    assert.deepEqual(options.tools, []);
    assert.equal(options.pathToClaudeCodeExecutable, '/tmp/fake-claude');
  });

  it('passes an explicit future CLI model through unchanged', async () => {
    capturedOptions = undefined;
    await runClaudeSkillSearch({
      prompt: 'Find a review skill',
      systemPrompt: 'Return JSON',
      model: 'future-claude-model',
    });

    const options = capturedOptions as Options | undefined;
    assert.ok(options);
    assert.equal(options.model, 'future-claude-model');
  });
});
