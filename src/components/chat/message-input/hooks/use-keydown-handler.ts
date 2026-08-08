import { useCallback, type KeyboardEvent, type RefObject } from 'react';
import { isImeComposingEvent } from '@/lib/ime';
import {
  navigateChatInputHistory,
  shouldUseInputHistoryNavigation,
} from '@/lib/chat-input-history';
import type { PopoverItem, PopoverMode } from '../constants';
import { getSessionScopedInputKey, INPUT_HISTORY_BY_SESSION } from '../session-state';

interface UseKeydownHandlerOptions {
  popoverMode: PopoverMode;
  popoverItems: PopoverItem[];
  allDisplayedItems: PopoverItem[];
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  insertItem: (item: PopoverItem) => void;
  closePopover: () => void;
  badgeActive: boolean;
  inputValue: string;
  removeBadge: () => void;
  sessionId?: string;
  historyIndex: number | null;
  historyDraftBeforeNavigation: string;
  setInputValue: (value: string) => void;
  setHistoryIndex: (index: number | null) => void;
  setHistoryDraftBeforeNavigation: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function useKeydownHandler({
  popoverMode,
  popoverItems,
  allDisplayedItems,
  selectedIndex,
  setSelectedIndex,
  insertItem,
  closePopover,
  badgeActive,
  inputValue,
  removeBadge,
  sessionId,
  historyIndex,
  historyDraftBeforeNavigation,
  setInputValue,
  setHistoryIndex,
  setHistoryDraftBeforeNavigation,
  textareaRef,
}: UseKeydownHandlerOptions) {
  return useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    const imeComposing = isImeComposingEvent(e);

    const isGlobalShortcut = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    if (isGlobalShortcut) {
      return;
    }

    if (popoverMode && popoverItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.key === 'Enter' && imeComposing) {
          return;
        }
        e.preventDefault();
        if (allDisplayedItems[selectedIndex]) {
          insertItem(allDisplayedItems[selectedIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopover();
        return;
      }
    }

    if (e.key === 'Backspace' && badgeActive && !inputValue) {
      e.preventDefault();
      removeBadge();
      return;
    }

    if (e.key === 'Escape' && badgeActive) {
      e.preventDefault();
      removeBadge();
      return;
    }

    if (!imeComposing && !badgeActive && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const inputKey = getSessionScopedInputKey(sessionId);
      const entries = INPUT_HISTORY_BY_SESSION.get(inputKey) || [];
      if (shouldUseInputHistoryNavigation({
        direction: e.key === 'ArrowUp' ? 'up' : 'down',
        inputValue,
        historyIndex,
        hasEntries: entries.length > 0,
        selectionStart: e.currentTarget.selectionStart,
        selectionEnd: e.currentTarget.selectionEnd,
      })) {
        e.preventDefault();
        const nextState = navigateChatInputHistory({
          entries,
          historyIndex,
          draftBeforeHistory: historyDraftBeforeNavigation,
          inputValue,
        }, e.key === 'ArrowUp' ? 'up' : 'down');

        setInputValue(nextState.value);
        setHistoryIndex(nextState.historyIndex);
        setHistoryDraftBeforeNavigation(nextState.draftBeforeHistory);

        window.requestAnimationFrame(() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          const cursor = nextState.value.length;
          textarea.focus();
          textarea.setSelectionRange(cursor, cursor);
        });
      }
    }
  }, [
    allDisplayedItems,
    badgeActive,
    closePopover,
    historyDraftBeforeNavigation,
    historyIndex,
    inputValue,
    insertItem,
    popoverItems,
    popoverMode,
    removeBadge,
    selectedIndex,
    sessionId,
    setHistoryDraftBeforeNavigation,
    setHistoryIndex,
    setInputValue,
    setSelectedIndex,
    textareaRef,
  ]);
}
