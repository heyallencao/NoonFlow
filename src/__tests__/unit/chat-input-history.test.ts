import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendChatInputHistory,
  navigateChatInputHistory,
  shouldUseInputHistoryNavigation,
  MAX_CHAT_INPUT_HISTORY,
} from '../../lib/chat-input-history';

describe('chat-input-history', () => {
  it('appends trimmed entries and skips consecutive duplicates', () => {
    let entries: string[] = [];

    entries = appendChatInputHistory(entries, '  first message  ');
    entries = appendChatInputHistory(entries, 'first message');
    entries = appendChatInputHistory(entries, 'second message');

    assert.deepEqual(entries, ['first message', 'second message']);
  });

  it('keeps only the latest configured number of entries', () => {
    let entries: string[] = [];

    for (let i = 0; i < MAX_CHAT_INPUT_HISTORY + 3; i += 1) {
      entries = appendChatInputHistory(entries, `message-${i}`);
    }

    assert.equal(entries.length, MAX_CHAT_INPUT_HISTORY);
    assert.equal(entries[0], 'message-3');
    assert.equal(entries.at(-1), `message-${MAX_CHAT_INPUT_HISTORY + 2}`);
  });

  it('starts from the latest history entry and restores the draft on the way back down', () => {
    const entries = ['first', 'second', 'third'];

    const upOnce = navigateChatInputHistory({
      entries,
      historyIndex: null,
      draftBeforeHistory: '',
      inputValue: 'draft text',
    }, 'up');
    assert.deepEqual(upOnce, {
      value: 'third',
      historyIndex: 2,
      draftBeforeHistory: 'draft text',
    });

    const upTwice = navigateChatInputHistory({
      entries,
      historyIndex: upOnce.historyIndex,
      draftBeforeHistory: upOnce.draftBeforeHistory,
      inputValue: upOnce.value,
    }, 'up');
    assert.equal(upTwice.value, 'second');
    assert.equal(upTwice.historyIndex, 1);

    const downTwice = navigateChatInputHistory({
      entries,
      historyIndex: 2,
      draftBeforeHistory: 'draft text',
      inputValue: 'third',
    }, 'down');
    assert.deepEqual(downTwice, {
      value: 'draft text',
      historyIndex: null,
      draftBeforeHistory: '',
    });
  });

  it('uses history navigation on single-line inputs', () => {
    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'up',
      inputValue: 'single line',
      historyIndex: null,
      hasEntries: true,
      selectionStart: 4,
      selectionEnd: 4,
    }), true);

    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'down',
      inputValue: 'single line',
      historyIndex: null,
      hasEntries: true,
      selectionStart: 2,
      selectionEnd: 2,
    }), true);
  });

  it('only hijacks multi-line navigation at the first or last line', () => {
    const multiLineValue = 'first line\nsecond line\nthird line';

    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'up',
      inputValue: multiLineValue,
      historyIndex: null,
      hasEntries: true,
      selectionStart: 3,
      selectionEnd: 3,
    }), true);

    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'up',
      inputValue: multiLineValue,
      historyIndex: null,
      hasEntries: true,
      selectionStart: 15,
      selectionEnd: 15,
    }), false);

    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'down',
      inputValue: multiLineValue,
      historyIndex: null,
      hasEntries: true,
      selectionStart: multiLineValue.length - 2,
      selectionEnd: multiLineValue.length - 2,
    }), true);

    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'down',
      inputValue: multiLineValue,
      historyIndex: null,
      hasEntries: true,
      selectionStart: 5,
      selectionEnd: 5,
    }), false);
  });

  it('continues navigating history once browsing has started', () => {
    assert.equal(shouldUseInputHistoryNavigation({
      direction: 'down',
      inputValue: 'third',
      historyIndex: 2,
      hasEntries: true,
      selectionStart: 0,
      selectionEnd: 0,
    }), true);
  });
});
