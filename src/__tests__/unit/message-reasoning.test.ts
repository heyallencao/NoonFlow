import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shouldReasoningStartCollapsed } from '../../components/chat/MessageReasoning';
import { ReasoningMarkdown } from '../../components/ai-elements/reasoning';

describe('message reasoning', () => {
  it('starts collapsed for long persisted reasoning content', () => {
    const longContent = '很长的思考内容。'.repeat(40);

    assert.equal(shouldReasoningStartCollapsed(longContent, false), true);
  });

  it('stays open by default while reasoning is still streaming', () => {
    const longContent = '很长的思考内容。'.repeat(40);

    assert.equal(shouldReasoningStartCollapsed(longContent, true), false);
  });
});

describe('ReasoningMarkdown', () => {
  it('has correct displayName', () => {
    assert.equal(ReasoningMarkdown.displayName, 'ReasoningMarkdown');
  });
});
