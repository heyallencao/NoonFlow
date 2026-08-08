import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getExternalNavigationUrl } from '../../lib/external-links';

describe('external links', () => {
  it('allows tel links for external navigation', () => {
    const next = getExternalNavigationUrl('tel:+123456789', 'https://app.example.com');
    assert.equal(next, 'tel:+123456789');
  });

  it('still blocks same-origin http links', () => {
    const next = getExternalNavigationUrl('https://app.example.com/path', 'https://app.example.com');
    assert.equal(next, null);
  });
});
