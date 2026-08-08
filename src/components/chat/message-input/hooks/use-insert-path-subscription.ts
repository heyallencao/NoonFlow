import { useEffect, type RefObject } from 'react';
import { subscribeInsertPathToChat } from '@/lib/events/app-event-bus';

interface UseInsertPathSubscriptionOptions {
  inputValue: string;
  setInputValue: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function useInsertPathSubscription({
  inputValue,
  setInputValue,
  textareaRef,
}: UseInsertPathSubscriptionOptions) {
  useEffect(() => {
    const unsubscribe = subscribeInsertPathToChat(({ path }) => {
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? inputValue.length;
      const before = inputValue.slice(0, cursorPos);
      const after = inputValue.slice(cursorPos);
      const insertText = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')
        ? ` ${path} `
        : `${path} `;

      setInputValue(before + insertText + after);

      setTimeout(() => {
        const currentTextarea = textareaRef.current;
        if (!currentTextarea) return;
        const newCursor = (before + insertText).length;
        currentTextarea.focus();
        currentTextarea.setSelectionRange(newCursor, newCursor);
      }, 0);
    });

    return unsubscribe;
  }, [inputValue, setInputValue, textareaRef]);
}
