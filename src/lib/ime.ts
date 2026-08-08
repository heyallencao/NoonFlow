export interface KeyboardEventLike {
  key: string;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
}

/**
 * Detect whether a keyboard event is in IME composing state.
 * Covers React synthetic events and browser native keyboard events.
 */
export function isImeComposingEvent(event: KeyboardEventLike): boolean {
  const nativeEvent = event.nativeEvent;
  return Boolean(
    event.isComposing ||
      nativeEvent?.isComposing ||
      event.key === "Process" ||
      nativeEvent?.keyCode === 229 ||
      nativeEvent?.which === 229
  );
}
