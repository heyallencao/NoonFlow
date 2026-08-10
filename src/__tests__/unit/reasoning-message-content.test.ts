import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAssistantMessageContent,
  isToolOnlyAssistantContent,
  parseAssistantMessageContent,
  serializeMessageContentBlocks,
} from '../../lib/message-content';
import type { MessageContentBlock } from '../../types';

describe('reasoning message content', () => {
  it('serializes reasoning as structured content even without tools', () => {
    const content = buildAssistantMessageContent({
      reasoning: 'I should inspect the schema first.',
      text: 'I found the issue in the persistence layer.',
    });

    assert.ok(content);
    assert.match(content!, /^\[/);

    const parsed = parseAssistantMessageContent(content!);
    assert.equal(parsed.reasoning, 'I should inspect the schema first.');
    assert.equal(parsed.text, 'I found the issue in the persistence layer.');
  });

  it('keeps reasoning alongside tool blocks', () => {
    const content = buildAssistantMessageContent({
      reasoning: 'Need to read the file before editing.',
      text: 'Patched the migration and renderer.',
      toolUses: [{ id: 'tool-1', name: 'Read', input: { path: 'src/lib/db.ts' } }],
      toolResults: [{ tool_use_id: 'tool-1', content: 'file contents', is_error: false }],
    });

    const parsed = parseAssistantMessageContent(content!);
    assert.equal(parsed.reasoning, 'Need to read the file before editing.');
    assert.equal(parsed.text, 'Patched the migration and renderer.');
    assert.equal(parsed.tools.length, 2);
    assert.equal(parsed.tools[0].type, 'tool_use');
    assert.equal(parsed.tools[1].type, 'tool_result');
  });

  it('preserves streaming block order when provided', () => {
    const content = buildAssistantMessageContent({
      toolUses: [{ id: 'tool-1', name: 'Read', input: { path: 'src/lib/db.ts' } }],
      toolResults: [{ tool_use_id: 'tool-1', content: 'file contents', is_error: false }],
      streamingBlocks: [
        { id: 'text-1', type: 'text', text: 'before tool' },
        { id: 'tool-1-block', type: 'tool', tool_use_id: 'tool-1' },
        { id: 'reasoning-1', type: 'reasoning', text: 'after tool reasoning' },
        { id: 'text-2', type: 'text', text: 'after tool' },
      ],
    });

    assert.ok(content);

    const parsedBlocks = JSON.parse(content!) as MessageContentBlock[];
    assert.deepEqual(
      parsedBlocks.map((block) => block.type),
      ['text', 'tool_use', 'tool_result', 'reasoning', 'text'],
    );
    assert.equal(parsedBlocks[0]?.type, 'text');
    assert.equal(parsedBlocks[0]?.type === 'text' ? parsedBlocks[0].text : '', 'before tool');
    assert.equal(parsedBlocks[3]?.type, 'reasoning');
    assert.equal(parsedBlocks[3]?.type === 'reasoning' ? parsedBlocks[3].text : '', 'after tool reasoning');
  });

  it('stores plain text as plain text when no reasoning or tools exist', () => {
    const blocks: MessageContentBlock[] = [
      { type: 'text', text: 'Plain response only.' },
    ];

    const content = serializeMessageContentBlocks(blocks);
    assert.equal(content, 'Plain response only.');
  });

  it('detects tool-only assistant content for compact timeline layout', () => {
    const content = serializeMessageContentBlocks([
      { type: 'tool_use', id: 'tool-1', name: 'exec', input: 'pwd' },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp' },
    ]);

    assert.equal(isToolOnlyAssistantContent(content), true);
  });

  it('does not compact assistant content that includes visible narrative text', () => {
    const content = serializeMessageContentBlocks([
      { type: 'tool_use', id: 'tool-1', name: 'exec', input: 'pwd' },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp' },
      { type: 'text', text: 'Command complete.' },
    ]);

    assert.equal(isToolOnlyAssistantContent(content), false);
  });

  it('treats reasoning as visible content only when reasoning is shown', () => {
    const content = serializeMessageContentBlocks([
      { type: 'reasoning', text: 'I should inspect the current directory.' },
      { type: 'tool_use', id: 'tool-1', name: 'exec', input: 'pwd' },
      { type: 'tool_result', tool_use_id: 'tool-1', content: '/tmp' },
    ]);

    assert.equal(isToolOnlyAssistantContent(content, false), true);
    assert.equal(isToolOnlyAssistantContent(content, true), false);
  });
});
