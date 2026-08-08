import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Root } from 'mdast';

import {
  STREAMDOWN_CODE_PLUGIN,
  normalizeStreamdownCodeFenceLanguages,
} from '../../lib/streamdown-plugins';
import { remarkPreserveSoftBreaks } from '../../lib/streamdown-remark-breaks';
import { STREAMDOWN_SHIKI_THEME } from '../../lib/streamdown-theme';

describe('STREAMDOWN_CODE_PLUGIN', () => {
  it('uses the shared high-contrast shiki theme pair', () => {
    assert.deepEqual(
      STREAMDOWN_CODE_PLUGIN.getThemes(),
      STREAMDOWN_SHIKI_THEME,
    );
  });

  it('preserves single-line breaks in plain text paragraphs', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: '✓ first line\n✓ second line',
            },
          ],
        },
      ],
    };

    remarkPreserveSoftBreaks()(tree);

    assert.deepEqual(tree.children[0], {
      type: 'paragraph',
      children: [
        { type: 'text', value: '✓ first line' },
        { type: 'break' },
        { type: 'text', value: '✓ second line' },
      ],
    });
  });

  it('normalizes show-widget fences to text fences', () => {
    const raw = [
      'before',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg></svg>"}',
      '```',
      'after',
    ].join('\n');

    const normalized = normalizeStreamdownCodeFenceLanguages(raw);
    assert.equal(normalized.includes('```show-widget'), false);
    assert.equal(normalized.includes('```text'), true);
  });

  it('normalizes declarative widget fences to text fences', () => {
    const raw = [
      '```widget-dashboard',
      '{"title":"sales","template":"bar","data":[{"label":"a","value":1}]}',
      '```',
      '```widget-table',
      '| name | value |',
      '| --- | --- |',
      '| a | 1 |',
      '```',
    ].join('\n');

    const normalized = normalizeStreamdownCodeFenceLanguages(raw);
    assert.equal(normalized.includes('```widget-dashboard'), false);
    assert.equal(normalized.includes('```widget-table'), false);
    assert.equal(normalized.match(/```text/g)?.length || 0, 2);
  });
});
