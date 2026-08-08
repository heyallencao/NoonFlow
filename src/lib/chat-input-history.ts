export const MAX_CHAT_INPUT_HISTORY = 50;

export interface InputHistoryNavigationState {
  entries: string[];
  historyIndex: number | null;
  draftBeforeHistory: string;
  inputValue: string;
}

export interface InputHistoryNavigationResult {
  value: string;
  historyIndex: number | null;
  draftBeforeHistory: string;
}

export function appendChatInputHistory(entries: string[], value: string): string[] {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return entries;
  }

  if (entries.at(-1) === normalizedValue) {
    return entries;
  }

  const nextEntries = [...entries, normalizedValue];
  if (nextEntries.length <= MAX_CHAT_INPUT_HISTORY) {
    return nextEntries;
  }

  return nextEntries.slice(nextEntries.length - MAX_CHAT_INPUT_HISTORY);
}

export function shouldUseInputHistoryNavigation(params: {
  direction: 'up' | 'down';
  inputValue: string;
  historyIndex: number | null;
  hasEntries: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
}): boolean {
  const { direction, inputValue, historyIndex, hasEntries, selectionStart, selectionEnd } = params;

  if (!hasEntries) {
    return false;
  }

  if (historyIndex !== null) {
    return true;
  }

  if (selectionStart === null || selectionEnd === null || selectionStart !== selectionEnd) {
    return false;
  }

  if (direction === 'up') {
    const firstLineEnd = inputValue.indexOf('\n');
    const boundary = firstLineEnd === -1 ? inputValue.length : firstLineEnd;
    return selectionStart <= boundary;
  }

  if (inputValue.length === 0) {
    return false;
  }

  const lastLineStart = inputValue.lastIndexOf('\n');
  const boundary = lastLineStart === -1 ? 0 : lastLineStart + 1;
  return selectionStart >= boundary;
}

export function navigateChatInputHistory(
  state: InputHistoryNavigationState,
  direction: 'up' | 'down',
): InputHistoryNavigationResult {
  const { entries, historyIndex, draftBeforeHistory, inputValue } = state;

  if (entries.length === 0) {
    return {
      value: inputValue,
      historyIndex,
      draftBeforeHistory,
    };
  }

  if (direction === 'up') {
    if (historyIndex === null) {
      return {
        value: entries[entries.length - 1],
        historyIndex: entries.length - 1,
        draftBeforeHistory: inputValue,
      };
    }

    const nextIndex = Math.max(0, historyIndex - 1);
    return {
      value: entries[nextIndex],
      historyIndex: nextIndex,
      draftBeforeHistory,
    };
  }

  if (historyIndex === null) {
    return {
      value: inputValue,
      historyIndex,
      draftBeforeHistory,
    };
  }

  if (historyIndex >= entries.length - 1) {
    return {
      value: draftBeforeHistory,
      historyIndex: null,
      draftBeforeHistory: '',
    };
  }

  const nextIndex = historyIndex + 1;
  return {
    value: entries[nextIndex],
    historyIndex: nextIndex,
    draftBeforeHistory,
  };
}
