import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Message } from '@/types';
import {
  countSearchMatches,
  getVisibleSearchTextForMessage,
  type SearchTarget,
} from './search';

interface UseChatSearchParams {
  messages: Message[];
  streamingContent: string;
  showStandaloneStreamingFallback: boolean;
  isTerminalOpen: boolean;
}

interface UseChatSearchResult {
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  isGlobalSearchVisible: boolean;
  globalSearchQuery: string;
  normalizedGlobalSearchQuery: string;
  totalSearchMatchCount: number;
  activeMatchDisplayIndex: number;
  matchedMessageIds: Set<string>;
  activeTerminalMatchIndex: number;
  activeChatMatchMessageId: string | null;
  activeChatMatchOccurrenceIndex: number | null;
  setTerminalSearchMatchCount: (value: number) => void;
  closeGlobalSearch: () => void;
  handleGlobalSearchQueryChange: (nextQuery: string) => void;
  navigateSearchTarget: (direction: 1 | -1) => void;
}

export function useChatSearch(params: UseChatSearchParams): UseChatSearchResult {
  const {
    messages,
    streamingContent,
    showStandaloneStreamingFallback,
    isTerminalOpen,
  } = params;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isGlobalSearchVisible, setIsGlobalSearchVisible] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [terminalSearchMatchCount, setTerminalSearchMatchCount] = useState(0);
  const [activeSearchTargetIndex, setActiveSearchTargetIndex] = useState(0);

  const normalizedGlobalSearchQuery = globalSearchQuery.trim();
  const normalizedQueryLower = normalizedGlobalSearchQuery.toLowerCase();
  const chatMessageMatches = useMemo(() => {
    if (!normalizedQueryLower) {
      return [] as Array<{ messageId: string; matchCount: number }>;
    }
    const matches: Array<{ messageId: string; matchCount: number }> = [];
    for (const message of messages) {
      const searchableText = getVisibleSearchTextForMessage(message);
      const matchCount = countSearchMatches(searchableText, normalizedQueryLower);
      if (matchCount > 0) {
        matches.push({ messageId: message.id, matchCount });
      }
    }
    return matches;
  }, [messages, normalizedQueryLower]);
  const orderedMatchedMessageIds = useMemo(
    () => chatMessageMatches.map((item) => item.messageId),
    [chatMessageMatches],
  );
  const matchedMessageIds = useMemo(() => new Set(orderedMatchedMessageIds), [orderedMatchedMessageIds]);
  const streamingMatchCount = useMemo(() => {
    if (!normalizedQueryLower || !showStandaloneStreamingFallback) {
      return 0;
    }
    return countSearchMatches(streamingContent, normalizedQueryLower);
  }, [normalizedQueryLower, showStandaloneStreamingFallback, streamingContent]);
  const searchTargets = useMemo<SearchTarget[]>(() => {
    if (!normalizedGlobalSearchQuery) {
      return [];
    }

    const targets: SearchTarget[] = [];
    for (const { messageId, matchCount } of chatMessageMatches) {
      for (let occurrenceIndex = 0; occurrenceIndex < matchCount; occurrenceIndex += 1) {
        targets.push({
          kind: 'chat',
          messageId,
          occurrenceIndex,
        });
      }
    }

    for (let occurrenceIndex = 0; occurrenceIndex < streamingMatchCount; occurrenceIndex += 1) {
      targets.push({ kind: 'streaming', occurrenceIndex });
    }

    for (let index = 0; index < terminalSearchMatchCount; index += 1) {
      targets.push({
        kind: 'terminal',
        matchIndex: index,
      });
    }

    return targets;
  }, [normalizedGlobalSearchQuery, chatMessageMatches, streamingMatchCount, terminalSearchMatchCount]);

  const normalizedActiveSearchTargetIndex = searchTargets.length === 0
    ? 0
    : Math.min(activeSearchTargetIndex, searchTargets.length - 1);
  const activeSearchTarget = searchTargets[normalizedActiveSearchTargetIndex] ?? null;
  const activeTerminalMatchIndex = activeSearchTarget?.kind === 'terminal'
    ? activeSearchTarget.matchIndex
    : 0;
  const activeChatMatchMessageId = activeSearchTarget?.kind === 'chat'
    ? activeSearchTarget.messageId
    : null;
  const activeChatMatchOccurrenceIndex = activeSearchTarget?.kind === 'chat'
    ? activeSearchTarget.occurrenceIndex
    : null;

  const chatSearchMatchCount = chatMessageMatches.reduce((sum, item) => sum + item.matchCount, 0)
    + streamingMatchCount;
  const totalSearchMatchCount = normalizedGlobalSearchQuery
    ? chatSearchMatchCount + terminalSearchMatchCount
    : 0;

  const closeGlobalSearch = useCallback(() => {
    setIsGlobalSearchVisible(false);
    setGlobalSearchQuery('');
    setActiveSearchTargetIndex(0);
  }, []);

  const handleGlobalSearchQueryChange = useCallback((nextQuery: string) => {
    setGlobalSearchQuery(nextQuery);
    setActiveSearchTargetIndex(0);
  }, []);

  const navigateSearchTarget = useCallback((direction: 1 | -1) => {
    if (searchTargets.length === 0) {
      return;
    }
    setActiveSearchTargetIndex((prev) => {
      const next = prev + direction;
      if (next < 0) {
        return searchTargets.length - 1;
      }
      if (next >= searchTargets.length) {
        return 0;
      }
      return next;
    });
  }, [searchTargets.length]);

  useEffect(() => {
    const isWithinDocPreview = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) {
        return false;
      }
      return Boolean(target.closest('[data-doc-preview-root="true"]'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const isFindShortcut = (event.metaKey || event.ctrlKey)
        && (event.key === 'f' || event.key === 'F');
      if (!isFindShortcut) {
        return;
      }
      if (isWithinDocPreview(event.target) || isWithinDocPreview(document.activeElement)) {
        return;
      }
      event.preventDefault();
      setIsGlobalSearchVisible(true);
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isTerminalOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setTerminalSearchMatchCount(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTerminalOpen]);

  useEffect(() => {
    if (!activeSearchTarget || !normalizedGlobalSearchQuery) {
      return;
    }
    if (activeSearchTarget.kind === 'chat') {
      const messageElement = document.getElementById(`msg-${activeSearchTarget.messageId}`);
      if (!messageElement) {
        return;
      }
      window.requestAnimationFrame(() => {
        const marks = messageElement.querySelectorAll<HTMLElement>('mark[data-chat-search-highlight="true"]');
        const activeMark = marks[activeSearchTarget.occurrenceIndex];
        if (activeMark) {
          activeMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        messageElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    if (activeSearchTarget.kind === 'streaming') {
      const streamingElement = document.getElementById('msg-streaming');
      streamingElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeSearchTarget, normalizedGlobalSearchQuery]);

  return {
    searchInputRef,
    isGlobalSearchVisible,
    globalSearchQuery,
    normalizedGlobalSearchQuery,
    totalSearchMatchCount,
    activeMatchDisplayIndex: normalizedActiveSearchTargetIndex + 1,
    matchedMessageIds,
    activeTerminalMatchIndex,
    activeChatMatchMessageId,
    activeChatMatchOccurrenceIndex,
    setTerminalSearchMatchCount,
    closeGlobalSearch,
    handleGlobalSearchQueryChange,
    navigateSearchTarget,
  };
}
