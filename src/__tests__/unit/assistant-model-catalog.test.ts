import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCodexModels } from '../../lib/assistant-model-catalog';

describe('assistant model catalog', () => {
  it('preserves CLI model order, default, labels, and arbitrary reasoning efforts', () => {
    assert.deepEqual(normalizeCodexModels({
      data: [
        {
          id: 'future-id',
          model: 'future-model',
          displayName: 'Future Model',
          description: 'Returned by the installed CLI',
          isDefault: true,
          defaultReasoningEffort: 'balanced-next',
          supportedReasoningEfforts: [
            { reasoningEffort: 'fast-next' },
            { reasoningEffort: 'balanced-next' },
          ],
        },
        {
          id: 'second-model',
          model: 'second-model',
          displayName: 'Second Model',
          isDefault: false,
          supportedReasoningEfforts: [],
        },
      ],
    }), {
      models: [
        {
          value: 'future-model',
          label: 'Future Model',
          description: 'Returned by the installed CLI',
          isDefault: true,
          supportedEffortLevels: ['fast-next', 'balanced-next'],
          defaultEffort: 'balanced-next',
        },
        { value: 'second-model', label: 'Second Model' },
      ],
      defaultModel: 'future-model',
    });
  });

  it('returns an empty catalog for malformed protocol output', () => {
    assert.deepEqual(normalizeCodexModels({ data: [{ model: '' }, null, 'bad' ] }), {
      models: [],
      defaultModel: '',
    });
  });
});
