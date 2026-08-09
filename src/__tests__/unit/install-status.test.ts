import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { initializationStepStatus, installCompletionStatus } from '../../../electron/lib/install-status';
import { needsNodeInstallation } from '../../lib/install-plan';

describe('install setup status', () => {
  it('keeps missing authentication distinct from installation failure or success', () => {
    assert.equal(initializationStepStatus(false), 'needs_setup');
    assert.equal(installCompletionStatus(true), 'needs_setup');
  });

  it('reports success only when requested initialization is ready', () => {
    assert.equal(initializationStepStatus(true), 'success');
    assert.equal(installCompletionStatus(false), 'success');
  });

  it('upgrades Node when Pi initialization alone needs a newer runtime', () => {
    assert.equal(needsNodeInstallation({
      hasNode: true,
      nodeSupportsPi: false,
      installClaude: false,
      installCodex: false,
      installPi: false,
      initializePi: true,
    }), true);
  });
});
