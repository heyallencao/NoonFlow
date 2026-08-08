import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { safeFindings } from '../../lib/dashboard-alerts';

describe('overview alerts helpers', () => {
  it('returns empty findings for loading state', () => {
    const findings = safeFindings<{ type: string }>(undefined);
    assert.deepEqual(findings, []);
  });
});
