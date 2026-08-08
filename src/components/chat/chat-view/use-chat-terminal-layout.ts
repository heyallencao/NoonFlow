import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TERMINAL_DRAG_INPUT_CLEARANCE_PX,
  TERMINAL_PANEL_LAYOUT_OVERHEAD_PX,
  TERMINAL_PANEL_STACK_OVERHEAD_PX,
} from './search';
import {
  TERMINAL_PANEL_MAX_HEIGHT,
  TERMINAL_PANEL_MIN_HEIGHT,
} from '@/hooks/useTerminalPanel';

interface UseChatTerminalLayoutParams {
  isTerminalOpen: boolean;
  terminalPanelHeight: number;
  setTerminalPanelHeight: (height: number) => void;
}

interface UseChatTerminalLayoutResult {
  chatViewportHeight: string;
  terminalDragLimitReached: boolean;
  isTerminalResizing: boolean;
  layoutSignal: number;
  setChatViewContainerRef: (node: HTMLDivElement | null) => void;
  setMessageInputContainerRef: (node: HTMLDivElement | null) => void;
  handleTerminalResizeStart: () => void;
  handleTerminalResize: (deltaY: number) => void;
  handleTerminalResizeEnd: () => void;
}

export function useChatTerminalLayout(
  params: UseChatTerminalLayoutParams,
): UseChatTerminalLayoutResult {
  const {
    isTerminalOpen,
    terminalPanelHeight,
    setTerminalPanelHeight,
  } = params;
  const [terminalDragLimitReached, setTerminalDragLimitReached] = useState(false);
  const [isTerminalResizing, setIsTerminalResizing] = useState(false);
  const [chatViewElement, setChatViewElement] = useState<HTMLDivElement | null>(null);
  const [messageInputElement, setMessageInputElement] = useState<HTMLDivElement | null>(null);
  const dragUpperLimitRef = useRef<number | null>(null);

  const chatViewportHeight = isTerminalOpen
    ? `calc(100% - ${terminalPanelHeight + TERMINAL_PANEL_STACK_OVERHEAD_PX}px)`
    : '100%';
  const layoutSignal = isTerminalOpen ? terminalPanelHeight : 0;

  const setChatViewContainerRef = useCallback((node: HTMLDivElement | null) => {
    setChatViewElement(node);
  }, []);

  const setMessageInputContainerRef = useCallback((node: HTMLDivElement | null) => {
    setMessageInputElement(node);
  }, []);

  const computeUpwardDragHeightLimit = useCallback(() => {
    if (!chatViewElement || !messageInputElement) {
      return TERMINAL_PANEL_MAX_HEIGHT;
    }

    const chatViewRect = chatViewElement.getBoundingClientRect();
    // Limit is based on total viewport height minus input area and terminal chrome overhead.
    // This keeps input fully visible while preserving upward drag elasticity.
    const maxHeightByGeometry = Math.floor(
      chatViewRect.height
      - messageInputElement.offsetHeight
      - TERMINAL_PANEL_LAYOUT_OVERHEAD_PX
      - TERMINAL_DRAG_INPUT_CLEARANCE_PX,
    );

    return Math.min(TERMINAL_PANEL_MAX_HEIGHT, Math.max(0, maxHeightByGeometry));
  }, [chatViewElement, messageInputElement]);

  const handleTerminalResizeStart = useCallback(() => {
    dragUpperLimitRef.current = computeUpwardDragHeightLimit();
    setTerminalDragLimitReached(false);
    setIsTerminalResizing(true);
  }, [computeUpwardDragHeightLimit]);

  const handleTerminalResize = useCallback((deltaY: number) => {
    const targetHeight = terminalPanelHeight - deltaY;
    const clampedHeight = Math.max(
      TERMINAL_PANEL_MIN_HEIGHT,
      Math.min(TERMINAL_PANEL_MAX_HEIGHT, targetHeight),
    );

    if (deltaY < 0) {
      const dragUpperLimit = dragUpperLimitRef.current ?? computeUpwardDragHeightLimit();
      const effectiveUpperLimit = Math.max(
        TERMINAL_PANEL_MIN_HEIGHT,
        Math.min(TERMINAL_PANEL_MAX_HEIGHT, dragUpperLimit),
      );
      const limitedHeight = Math.min(clampedHeight, effectiveUpperLimit);
      setTerminalPanelHeight(limitedHeight);
      setTerminalDragLimitReached(limitedHeight < clampedHeight);
      return;
    }

    setTerminalPanelHeight(clampedHeight);
    setTerminalDragLimitReached(false);
  }, [computeUpwardDragHeightLimit, setTerminalPanelHeight, terminalPanelHeight]);

  const handleTerminalResizeEnd = useCallback(() => {
    dragUpperLimitRef.current = null;
    setTerminalDragLimitReached(false);
    setIsTerminalResizing(false);
  }, []);

  useEffect(() => {
    if (isTerminalOpen) return;
    dragUpperLimitRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      setTerminalDragLimitReached(false);
      setIsTerminalResizing(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTerminalOpen]);

  // Keep conversation layout synchronized while terminal height changes.
  useEffect(() => {
    if (!isTerminalOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTerminalOpen, terminalPanelHeight]);

  return {
    chatViewportHeight,
    terminalDragLimitReached,
    isTerminalResizing,
    layoutSignal,
    setChatViewContainerRef,
    setMessageInputContainerRef,
    handleTerminalResizeStart,
    handleTerminalResize,
    handleTerminalResizeEnd,
  };
}
