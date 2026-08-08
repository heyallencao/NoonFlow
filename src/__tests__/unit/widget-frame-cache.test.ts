import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearWidgetHeightCacheForTests,
  getCachedWidgetHeight,
  setCachedWidgetHeight,
  WIDGET_HEIGHT_CACHE_MAX_ENTRIES,
} from '../../lib/widget-frame-cache';

describe('widget frame cache', () => {
  beforeEach(() => {
    clearWidgetHeightCacheForTests();
  });

  it('returns null for unknown cache key', () => {
    assert.equal(getCachedWidgetHeight('unknown-key-001'), null);
  });

  it('stores and reads cached height', () => {
    setCachedWidgetHeight('widget-a', 320);
    assert.equal(getCachedWidgetHeight('widget-a'), 320);
  });

  it('ignores invalid values', () => {
    setCachedWidgetHeight('widget-b', Number.NaN);
    assert.equal(getCachedWidgetHeight('widget-b'), null);
  });

  it('evicts oldest entries when cache exceeds limit', () => {
    for (let index = 0; index < WIDGET_HEIGHT_CACHE_MAX_ENTRIES + 8; index += 1) {
      setCachedWidgetHeight(`widget-${index}`, 120 + index);
    }

    assert.equal(getCachedWidgetHeight('widget-0'), null);
    assert.equal(
      getCachedWidgetHeight(`widget-${WIDGET_HEIGHT_CACHE_MAX_ENTRIES + 7}`),
      120 + WIDGET_HEIGHT_CACHE_MAX_ENTRIES + 7,
    );
  });
});
