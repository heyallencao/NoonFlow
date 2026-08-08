import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CommandBadge, PopoverItem, PopoverMode } from '../constants';
import { fetchFilePopoverItems, fetchSkillPopoverItems, type FilePopoverFetchResult } from '../data-sources';

interface UsePopoverControllerOptions {
  inputValue: string;
  setInputValue: (value: string) => void;
  historyIndex: number | null;
  clearHistoryNavigationState: () => void;
  modelName?: string;
  workingDirectory?: string;
  onCommand?: (command: string) => void;
  setBadge: (badge: CommandBadge | null) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UsePopoverControllerResult {
  popoverMode: PopoverMode;
  popoverItems: PopoverItem[];
  popoverFilter: string;
  selectedIndex: number;
  triggerPos: number | null;
  filteredItems: PopoverItem[];
  allDisplayedItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  fileHasMore: boolean;
  fileLoadingMore: boolean;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  setPopoverFilter: (value: string) => void;
  closePopover: () => void;
  loadMoreFileItems: () => Promise<void>;
  insertItem: (item: PopoverItem) => void;
  handleInputChange: (value: string) => Promise<void>;
}

export function usePopoverController({
  inputValue,
  setInputValue,
  historyIndex,
  clearHistoryNavigationState,
  modelName,
  onCommand,
  setBadge,
  textareaRef,
  workingDirectory,
}: UsePopoverControllerOptions): UsePopoverControllerResult {
  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<PopoverItem[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [fileNextOffset, setFileNextOffset] = useState(0);
  const [fileHasMore, setFileHasMore] = useState(false);
  const [fileLoadingMore, setFileLoadingMore] = useState(false);
  const aiSearchAbortRef = useRef<AbortController | null>(null);
  const aiSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFiles = useCallback(
    (filter: string, offset: number = 0): Promise<FilePopoverFetchResult> => (
      fetchFilePopoverItems(workingDirectory, filter, offset, 20)
    ),
    [workingDirectory],
  );

  const fetchSkills = useCallback(
    () => fetchSkillPopoverItems(workingDirectory),
    [workingDirectory],
  );

  const closePopover = useCallback(() => {
    setPopoverMode(null);
    setPopoverItems([]);
    setPopoverFilter('');
    setSelectedIndex(0);
    setTriggerPos(null);
    setFileNextOffset(0);
    setFileHasMore(false);
    setFileLoadingMore(false);
    setAiSuggestions([]);
    setAiSearchLoading(false);

    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
      aiSearchTimerRef.current = null;
    }

    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
      aiSearchAbortRef.current = null;
    }
  }, []);

  const loadMoreFileItems = useCallback(async () => {
    if (popoverMode !== 'file' || fileLoadingMore || !fileHasMore) {
      return;
    }

    setFileLoadingMore(true);
    try {
      const nextPage = await fetchFiles(popoverFilter, fileNextOffset);
      setPopoverItems((prev) => {
        const seen = new Set(prev.map((item) => item.value));
        const merged = [...prev];
        for (const item of nextPage.items) {
          if (seen.has(item.value)) continue;
          seen.add(item.value);
          merged.push(item);
        }
        return merged;
      });
      setFileHasMore(nextPage.hasMore);
      setFileNextOffset(nextPage.nextOffset);
    } finally {
      setFileLoadingMore(false);
    }
  }, [fetchFiles, fileHasMore, fileLoadingMore, fileNextOffset, popoverFilter, popoverMode]);

  const insertItem = useCallback((item: PopoverItem) => {
    if (triggerPos === null) return;

    if (item.builtIn && item.immediate && onCommand) {
      setInputValue('');
      closePopover();
      onCommand(item.value);
      return;
    }

    if (popoverMode === 'skill') {
      setBadge({
        command: item.value,
        label: item.label,
        description: item.description || '',
        isSkill: !item.builtIn,
        installedSource: item.installedSource,
      });
      setInputValue('');
      closePopover();
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    const before = inputValue.slice(0, triggerPos);
    const cursorEnd = triggerPos + popoverFilter.length + 1;
    const after = inputValue.slice(cursorEnd);
    const insertText = `@${item.value} `;

    setInputValue(before + insertText + after);
    closePopover();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [closePopover, inputValue, onCommand, popoverFilter.length, popoverMode, setBadge, setInputValue, textareaRef, triggerPos]);

  const handleInputChange = useCallback(async (value: string) => {
    if (historyIndex !== null) {
      clearHistoryNavigationState();
    }
    setInputValue(value);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const beforeCursor = value.slice(0, cursorPos);

    const atMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const filter = atMatch[1];
      setPopoverMode('file');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - atMatch[0].length);
      setSelectedIndex(0);
      setFileLoadingMore(false);
      const filePage = await fetchFiles(filter, 0);
      setPopoverItems(filePage.items);
      setFileHasMore(filePage.hasMore);
      setFileNextOffset(filePage.nextOffset);
      return;
    }

    const slashMatch = beforeCursor.match(/(^|\s)\/([^\s/]*)$/);
    if (slashMatch) {
      const filter = slashMatch[2];
      setPopoverMode('skill');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - slashMatch[2].length - 1);
      setSelectedIndex(0);
      setFileNextOffset(0);
      setFileHasMore(false);
      setFileLoadingMore(false);
      const items = await fetchSkills();
      setPopoverItems(items);
      return;
    }

    if (popoverMode) {
      closePopover();
    }
  }, [clearHistoryNavigationState, closePopover, fetchFiles, fetchSkills, historyIndex, popoverMode, setInputValue, textareaRef]);

  const filteredItems = useMemo(() => {
    const query = popoverFilter.toLowerCase();
    return popoverItems.filter((item) => (
      item.label.toLowerCase().includes(query)
      || (item.description || '').toLowerCase().includes(query)
    ));
  }, [popoverFilter, popoverItems]);

  const nonBuiltInFilteredCount = useMemo(
    () => filteredItems.filter((item) => !item.builtIn).length,
    [filteredItems],
  );

  useEffect(() => {
    if (popoverMode !== 'skill' || popoverFilter.length < 2 || nonBuiltInFilteredCount >= 2) {
      setAiSuggestions([]);
      setAiSearchLoading(false);
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
      if (aiSearchAbortRef.current) {
        aiSearchAbortRef.current.abort();
        aiSearchAbortRef.current = null;
      }
      return;
    }

    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
    }
    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
    }

    setAiSearchLoading(true);

    aiSearchTimerRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      aiSearchAbortRef.current = abortController;

      try {
        const skillsPayload = popoverItems
          .filter((item) => !item.builtIn)
          .map((item) => ({
            name: item.label,
            description: (item.description || '').slice(0, 100),
          }));

        if (skillsPayload.length === 0) {
          setAiSearchLoading(false);
          return;
        }

        const response = await fetch('/api/skills/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            query: popoverFilter,
            skills: skillsPayload,
            model: modelName || 'haiku',
          }),
        });

        if (abortController.signal.aborted) return;

        if (!response.ok) {
          setAiSuggestions([]);
          setAiSearchLoading(false);
          return;
        }

        const data = await response.json() as { suggestions?: string[] };
        const suggestions = data.suggestions || [];

        const filteredNames = new Set(filteredItems.map((item) => item.label));
        const aiItems = suggestions
          .filter((name) => !filteredNames.has(name))
          .map((name) => popoverItems.find((item) => item.label === name))
          .filter((item): item is PopoverItem => !!item);

        setAiSuggestions(aiItems);
      } catch {
        if (!abortController.signal.aborted) {
          setAiSuggestions([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setAiSearchLoading(false);
        }
      }
    }, 500);

    return () => {
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelName, nonBuiltInFilteredCount, popoverFilter, popoverItems, popoverMode]);

  const allDisplayedItems = useMemo(
    () => [...filteredItems, ...aiSuggestions],
    [aiSuggestions, filteredItems],
  );

  return {
    popoverMode,
    popoverItems,
    popoverFilter,
    selectedIndex,
    triggerPos,
    filteredItems,
    allDisplayedItems,
    aiSuggestions,
    aiSearchLoading,
    fileHasMore,
    fileLoadingMore,
    setSelectedIndex,
    setPopoverFilter,
    closePopover,
    loadMoreFileItems,
    insertItem,
    handleInputChange,
  };
}
