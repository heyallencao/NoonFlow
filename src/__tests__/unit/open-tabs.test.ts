import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { promoteOpenTabId, sanitizeOpenTabIds } from '../../lib/open-tabs';

describe('open tab ordering', () => {
  it('deduplicates and removes empty ids', () => {
    assert.deepEqual(
      sanitizeOpenTabIds(['tab-1', '', 'tab-2', 'tab-1']),
      ['tab-1', 'tab-2'],
    );
  });

  it('moves the active tab to the end so it becomes the preferred restored tab', () => {
    assert.deepEqual(
      promoteOpenTabId(['tab-a', 'tab-b', 'tab-c'], 'tab-b'),
      ['tab-a', 'tab-c', 'tab-b'],
    );
  });

  it('appends a newly active tab when it was not open before', () => {
    assert.deepEqual(
      promoteOpenTabId(['tab-a', 'tab-b'], 'tab-c'),
      ['tab-a', 'tab-b', 'tab-c'],
    );
  });
});
