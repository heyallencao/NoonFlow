import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { MessagePartRecord } from '../../lib/db-core';
import type { MessageContentBlock } from '../../types';
import {
  buildMessagePartInputs,
  replayMessageContentFromParts,
  resolveMessageContentFromParts,
  serializeMessageContentBlocks,
} from '../../lib/message-content';

function createPart(overrides: Partial<MessagePartRecord>): MessagePartRecord {
  return {
    id: overrides.id ?? 1,
    session_id: overrides.session_id ?? 'session-1',
    message_id: overrides.message_id ?? 'message-1',
    part_type: overrides.part_type ?? 'text',
    content: overrides.content ?? '',
    metadata: overrides.metadata ?? null,
    created_at: overrides.created_at ?? 1,
    part_key: overrides.part_key ?? null,
    part_index: overrides.part_index ?? null,
    revision: overrides.revision ?? null,
    is_final: overrides.is_final ?? null,
    updated_at: overrides.updated_at ?? null,
  };
}

describe('message part replay', () => {
  it('replays legacy parts into structured content', () => {
    const parts: MessagePartRecord[] = [
      createPart({ id: 1, part_type: 'text', content: 'Legacy hello. ' }),
      createPart({
        id: 2,
        part_type: 'tool_use',
        content: JSON.stringify({ path: '/tmp/demo.ts' }),
        metadata: JSON.stringify({ id: 'tool-1', name: 'Read' }),
      }),
      createPart({
        id: 3,
        part_type: 'tool_result',
        content: 'file body',
        metadata: JSON.stringify({ tool_use_id: 'tool-1', is_error: false }),
      }),
    ];

    const expectedBlocks: MessageContentBlock[] = [
      { type: 'text', text: 'Legacy hello. ' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/demo.ts' } },
      { type: 'tool_result', tool_use_id: 'tool-1', content: 'file body', is_error: false },
    ];

    assert.equal(
      replayMessageContentFromParts(parts),
      serializeMessageContentBlocks(expectedBlocks),
    );
  });

  it('prefers v2 parts when they are available and not streaming', () => {
    const parts: MessagePartRecord[] = [
      createPart({ id: 1, part_type: 'text', content: 'legacy fallback' }),
      createPart({ id: 2, part_type: 'reasoning', content: 'thinking', part_key: 'reasoning:0', part_index: 0 }),
      createPart({ id: 3, part_type: 'text', content: 'final answer', part_key: 'text:0', part_index: 1 }),
    ];

    const expectedBlocks: MessageContentBlock[] = [
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'final answer' },
    ];

    assert.equal(
      resolveMessageContentFromParts({
        content: 'legacy row content',
        status: null,
        parts,
      }),
      serializeMessageContentBlocks(expectedBlocks),
    );
  });

  it('falls back to legacy content while v2 parts are still streaming', () => {
    const parts: MessagePartRecord[] = [
      createPart({ id: 1, part_type: 'text', content: 'legacy terminal content' }),
      createPart({
        id: 2,
        part_type: 'text',
        content: 'partial streaming content',
        part_key: 'text:0',
        part_index: 0,
        revision: 1,
        is_final: 0,
      }),
    ];

    assert.equal(
      resolveMessageContentFromParts({
        content: 'legacy terminal content',
        status: 'streaming',
        parts,
      }),
      'legacy terminal content',
    );
  });

  it('builds stable v2 part metadata for dual-write', () => {
    const inputs = buildMessagePartInputs(
      [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/tmp/demo.ts' } },
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'done', is_error: false },
      ],
      {
        includeStableKeys: true,
        revision: 3,
        isFinal: true,
        updatedAt: 100,
      },
    );

    assert.deepEqual(
      inputs.map((input) => ({
        partType: input.partType,
        partKey: input.partKey,
        partIndex: input.partIndex,
        revision: input.revision,
        isFinal: input.isFinal,
      })),
      [
        { partType: 'reasoning', partKey: 'reasoning:0', partIndex: 0, revision: 3, isFinal: true },
        { partType: 'text', partKey: 'text:0', partIndex: 1, revision: 3, isFinal: true },
        { partType: 'tool_use', partKey: 'tool_use:tool-1', partIndex: 2, revision: 3, isFinal: true },
        { partType: 'tool_result', partKey: 'tool_result:tool-1', partIndex: 3, revision: 3, isFinal: true },
      ],
    );
  });
});
