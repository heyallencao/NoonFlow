import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeEnvironmentJson } from '../../lib/environment-snapshot';

describe('/api/environment secret masking', () => {
  it('masks Pi auth key and nested token fields', () => {
    const sanitized = sanitizeEnvironmentJson({
      anthropic: { type: 'api_key', key: 'pi-secret-value' },
      oauth: { accessToken: 'oauth-secret-value' },
      harmless: 'visible',
    }) as Record<string, unknown>;

    assert.equal((sanitized.anthropic as Record<string, unknown>).key, 'pi-s***alue');
    assert.equal((sanitized.oauth as Record<string, unknown>).accessToken, 'oaut***alue');
    assert.equal(sanitized.harmless, 'visible');
  });
});
