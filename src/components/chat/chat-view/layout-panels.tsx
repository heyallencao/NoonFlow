import type { RefObject } from 'react';

import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { VerticalResizeHandle } from '@/components/layout/VerticalResizeHandle';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from 'lucide-react';

interface SearchOverlayProps {
  isVisible: boolean;
  query: string;
  normalizedQuery: string;
  totalMatchCount: number;
  activeMatchDisplayIndex: number;
  placeholder: string;
  shortcutLabel: string;
  closeLabel: string;
  zeroResultsLabel: string;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onNavigateNext: () => void;
  onNavigatePrevious: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SearchOverlay({
  isVisible,
  query,
  normalizedQuery,
  totalMatchCount,
  activeMatchDisplayIndex,
  placeholder,
  shortcutLabel,
  closeLabel,
  zeroResultsLabel,
  onClose,
  onQueryChange,
  onNavigateNext,
  onNavigatePrevious,
  inputRef,
}: SearchOverlayProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-xl border border-border-default/80 bg-bg-secondary/95 px-3 py-2 shadow-xl backdrop-blur">
        <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) {
                onNavigatePrevious();
              } else {
                onNavigateNext();
              }
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {normalizedQuery && (
          <>
            <button
              type="button"
              onClick={onNavigatePrevious}
              disabled={totalMatchCount === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              aria-label="Previous result"
            >
              <ChevronUpIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNavigateNext}
              disabled={totalMatchCount === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              aria-label="Next result"
            >
              <ChevronDownIcon className="h-4 w-4" />
            </button>
          </>
        )}
        {normalizedQuery ? (
          <span className="rounded-md border border-border-subtle px-2 py-1 text-xs text-muted-foreground">
            {totalMatchCount > 0
              ? `${activeMatchDisplayIndex}/${totalMatchCount}`
              : zeroResultsLabel}
          </span>
        ) : (
          <span className="hidden rounded-md border border-border-subtle px-2 py-1 text-xs text-muted-foreground md:inline-flex">
            {shortcutLabel}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-bg-hover hover:text-foreground"
          aria-label={closeLabel}
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

interface TerminalDockProps {
  isOpen: boolean;
  terminalSessionId: string | null;
  workingDirectory: string;
  terminalHeight: number;
  terminalDragLimitReached: boolean;
  upperLimitLabel: string;
  searchQuery: string;
  activeTerminalMatchIndex: number;
  onResizeStart: () => void;
  onResize: (deltaY: number) => void;
  onResizeEnd: () => void;
  onClose: () => void;
  onToggle?: () => void;
  onSearchMatchesChange: (count: number) => void;
}

export function TerminalDock({
  isOpen,
  terminalSessionId,
  workingDirectory,
  terminalHeight,
  terminalDragLimitReached,
  upperLimitLabel,
  searchQuery,
  activeTerminalMatchIndex,
  onResizeStart,
  onResize,
  onResizeEnd,
  onClose,
  onToggle,
  onSearchMatchesChange,
}: TerminalDockProps) {
  if (!isOpen || !terminalSessionId) {
    return null;
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div className="h-2 shrink-0" aria-hidden />
      <VerticalResizeHandle
        onResizeStart={onResizeStart}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
        label="Resize terminal panel"
        atUpperLimit={terminalDragLimitReached}
        upperLimitLabel={upperLimitLabel}
      />
      <TerminalPanel
        sessionId={terminalSessionId}
        workingDirectory={workingDirectory}
        height={terminalHeight}
        onClose={onClose}
        onToggle={onToggle}
        searchQuery={searchQuery}
        onSearchMatchesChange={onSearchMatchesChange}
        activeMatchIndex={activeTerminalMatchIndex}
      />
    </div>
  );
}
