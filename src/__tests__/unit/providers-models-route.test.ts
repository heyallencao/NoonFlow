import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-providers-models-route-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

let closeDb: typeof import('../../lib/db').closeDb;
let createProvider: typeof import('../../lib/db').createProvider;
let getModels: typeof import('../../app/api/providers/models/route').GET;

const originalAnthropicModel = process.env.ANTHROPIC_MODEL;

before(async () => {
  ({ closeDb, createProvider } = await import('../../lib/db'));
  ({ GET: getModels } = await import('../../app/api/providers/models/route'));
});

afterEach(() => {
  closeDb();
  if (originalAnthropicModel === undefined) {
    delete process.env.ANTHROPIC_MODEL;
  } else {
    process.env.ANTHROPIC_MODEL = originalAnthropicModel;
  }
});

describe('/api/providers/models GET', () => {
  it('prefers provider extra_env ANTHROPIC_MODEL over base_url preset labels', async () => {
    const provider = createProvider({
      name: 'MiniMax Custom Model',
      provider_type: 'custom',
      base_url: 'https://api.minimax.io/anthropic',
      api_key: 'test-key',
      extra_env: JSON.stringify({
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: 'MiniMax-M1',
      }),
    });

    const response = await getModels();
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      groups: Array<{
        provider_id: string;
        models: Array<{ value: string; label: string }>;
      }>;
    };

    const group = payload.groups.find((item) => item.provider_id === provider.id);
    assert.ok(group);
    assert.deepEqual(group.models, [{ value: 'MiniMax-M1', label: 'MiniMax-M1' }]);
  });

  it('uses environment ANTHROPIC_MODEL for built-in Claude Code group', async () => {
    process.env.ANTHROPIC_MODEL = 'env-custom-model';

    const response = await getModels();
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      groups: Array<{
        provider_id: string;
        models: Array<{ value: string; label: string }>;
      }>;
    };

    const envGroup = payload.groups.find((item) => item.provider_id === 'env');
    assert.ok(envGroup);
    assert.deepEqual(envGroup.models, [{ value: 'env-custom-model', label: 'env-custom-model' }]);
  });
});
