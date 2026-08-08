import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildWidgetRecoverFallbackEvent } from '../../lib/widget-error-boundary-telemetry';

describe('widget error boundary telemetry helpers', () => {
  it('marks text fallback recover event as failed', () => {
    const event = buildWidgetRecoverFallbackEvent(new Error('render boom'), {
      sessionId: 'session-1',
      messageId: 'message-1',
      traceId: 'trace-1',
    });
    assert.equal(event.event, 'widget_recover');
    assert.equal(event.code, 'W_RECOVER_TEXT_FALLBACK');
    assert.equal(event.ok, false);
    assert.equal(event.messageId, 'message-1');
  });
});
