import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CHAT_ROLLOUT_MODE,
  getChatRolloutMode,
  normalizeChatRolloutMode,
  shouldShowStandaloneStreamingFallback,
  usesBridgeCompatibilityFallbacks,
  usesLegacyReconciliationFallback,
} from '../../lib/chat-rollout';

describe('chat-rollout', () => {
  it('defaults invalid rollout values to bridge', () => {
    assert.equal(normalizeChatRolloutMode(undefined), DEFAULT_CHAT_ROLLOUT_MODE);
    assert.equal(normalizeChatRolloutMode('unknown'), DEFAULT_CHAT_ROLLOUT_MODE);
  });

  it('reads explicit rollout values', () => {
    assert.equal(getChatRolloutMode('legacy'), 'legacy');
    assert.equal(getChatRolloutMode('bridge'), 'bridge');
    assert.equal(getChatRolloutMode('canonical'), 'canonical');
  });

  it('only enables bridge compatibility fallbacks outside canonical mode', () => {
    assert.equal(usesBridgeCompatibilityFallbacks('legacy'), true);
    assert.equal(usesBridgeCompatibilityFallbacks('bridge'), true);
    assert.equal(usesBridgeCompatibilityFallbacks('canonical'), false);
  });

  it('only enables reconciliation fallback in legacy mode', () => {
    assert.equal(usesLegacyReconciliationFallback('legacy'), true);
    assert.equal(usesLegacyReconciliationFallback('bridge'), false);
    assert.equal(usesLegacyReconciliationFallback('canonical'), false);
  });

  it('shows standalone streaming fallback only for legacy snapshots without client ids', () => {
    assert.equal(shouldShowStandaloneStreamingFallback('legacy', {
      isStreaming: true,
      hasActiveStreamingAssistantMessage: false,
      activeStreamingClientMessageId: null,
    }), true);

    assert.equal(shouldShowStandaloneStreamingFallback('legacy', {
      isStreaming: true,
      hasActiveStreamingAssistantMessage: false,
      activeStreamingClientMessageId: 'msg-123',
    }), false);

    assert.equal(shouldShowStandaloneStreamingFallback('bridge', {
      isStreaming: true,
      hasActiveStreamingAssistantMessage: false,
      activeStreamingClientMessageId: null,
    }), false);

    assert.equal(shouldShowStandaloneStreamingFallback('canonical', {
      isStreaming: true,
      hasActiveStreamingAssistantMessage: false,
      activeStreamingClientMessageId: null,
    }), false);
  });
});
