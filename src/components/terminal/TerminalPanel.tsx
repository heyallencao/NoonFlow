'use client';

import 'xterm/css/xterm.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useFontSize } from '@/components/layout/FontSizeProvider';
import {
  appendTerminalOutputSnapshot,
  getTerminalOutputSnapshot,
  getTerminalRuntimeStatusSnapshot,
  replaceTerminalOutputSnapshot,
  setTerminalRuntimeStatusSnapshot,
} from '@/lib/terminal-buffer-cache';

const DESKTOP_BRIDGE_READY_EVENT = 'noonflow:desktop-bridge-ready';
const SNAPSHOT_POLL_INTERVAL_MS = 180;
const SNAPSHOT_IDLE_GRACE_MS = 300;
const TERMINAL_FONT_SIZE_BASE_PX = 14;

function hasTerminalRendererReady(term: import('xterm').Terminal | null): boolean {
  if (!term) return false;
  const internal = term as unknown as {
    _core?: {
      _renderService?: {
        _renderer?: { value?: unknown };
        dimensions?: unknown;
      };
    };
  };
  const renderService = internal._core?._renderService;
  if (!renderService) return false;
  if (!renderService._renderer?.value) return false;

  // Try to access dimensions - it's a getter that may throw if dependencies aren't ready
  try {
    const dims = renderService.dimensions;
    return Boolean(dims);
  } catch {
    return false;
  }
}

function hasDesktopTerminalApi() {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.terminal);
}

interface TerminalPanelProps {
  sessionId: string;
  workingDirectory: string;
  height: number;
  onClose: () => void;
  onToggle?: () => void;
  searchQuery?: string;
  onSearchMatchesChange?: (count: number) => void;
  activeMatchIndex?: number;
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 3.5L6.5 8L2 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 12.5H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

export function TerminalPanel({
  sessionId,
  workingDirectory,
  height,
  onClose,
  onToggle,
  searchQuery = '',
  onSearchMatchesChange,
  activeMatchIndex = 0,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  const { fontScale } = useFontSize();

  const [runtimeStatus, setRuntimeStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(() => hasDesktopTerminalApi());

  const terminalRef = useRef<import('xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalLayoutReadyRef = useRef(false);
  const disposedRef = useRef(false);
  const fitRafRef = useRef<number | null>(null);
  const fitTimeoutRef = useRef<number | null>(null);
  const searchObserverRef = useRef<MutationObserver | null>(null);

  const terminalFontSize = useMemo(() => Math.round(TERMINAL_FONT_SIZE_BASE_PX * fontScale), [fontScale]);
  const handleClosePanel = useCallback(() => {
    // Enter teardown mode immediately to avoid xterm renderer races while close events are in flight.
    disposedRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncDesktopRuntime = () => setIsDesktopRuntime(hasDesktopTerminalApi());
    syncDesktopRuntime();
    window.addEventListener(DESKTOP_BRIDGE_READY_EVENT, syncDesktopRuntime);
    return () => window.removeEventListener(DESKTOP_BRIDGE_READY_EVENT, syncDesktopRuntime);
  }, []);

  const applyFitAndResize = useCallback(() => {
    if (disposedRef.current) return;
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = terminalContainerRef.current;
    if (!term || !fitAddon || !container?.isConnected) return;
    if (!term.element?.isConnected) return;
    if (!hasTerminalRendererReady(term)) return;
    if (container.clientWidth < 24 || container.clientHeight < 24) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    if (term.cols > 0 && term.rows > 0) {
      window.electronAPI?.terminal
        ?.resize({ sessionId, cols: term.cols, rows: term.rows })
        .catch(() => {});
    }
  }, [sessionId]);

  const scheduleFitAndResize = useCallback(() => {
    if (fitRafRef.current !== null) return;
    const run = () => {
      fitRafRef.current = null;
      if (fitTimeoutRef.current !== null) {
        window.clearTimeout(fitTimeoutRef.current);
        fitTimeoutRef.current = null;
      }
      applyFitAndResize();
    };
    fitRafRef.current = window.requestAnimationFrame(run);
    fitTimeoutRef.current = window.setTimeout(() => {
      if (fitRafRef.current === null) return;
      window.cancelAnimationFrame(fitRafRef.current);
      run();
    }, 48);
  }, [applyFitAndResize]);

  const safeClearSelection = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    if (!hasTerminalRendererReady(term)) return;
    if (!term.element?.isConnected) return;
    try {
      term.clearSelection();
    } catch {
      // Ignore renderer race conditions in early mount / teardown.
    }
  }, []);

  const safeSelectMatch = useCallback((row: number, column: number, length: number) => {
    const term = terminalRef.current;
    if (!term) return;
    if (!hasTerminalRendererReady(term)) return;
    if (!term.element?.isConnected) return;
    try {
      term.scrollToLine(row);
      term.select(column, row, length);
    } catch {
      // Ignore renderer race conditions in early mount / teardown.
    }
  }, []);

  const clearSearchHighlights = useCallback(() => {
    safeClearSelection();
    onSearchMatchesChange?.(0);
  }, [onSearchMatchesChange, safeClearSelection]);

  const applySearchHighlights = useCallback((scrollToActiveMatch: boolean = false) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const term = terminalRef.current;

    if (!normalizedQuery || !term) {
      safeClearSelection();
      onSearchMatchesChange?.(0);
      return;
    }

    // Character-level positioning for the first match across full terminal buffer.
    const activeBuffer = term.buffer.active;
    const bufferLength = activeBuffer.length;
    const queryLength = normalizedQuery.length;
    const matchPositions: Array<{ row: number; column: number }> = [];

    for (let row = 0; row < bufferLength; row += 1) {
      const line = activeBuffer.getLine(row)?.translateToString(true).toLowerCase() ?? '';
      if (!line) {
        continue;
      }
      let fromIndex = 0;
      while (fromIndex <= line.length - queryLength) {
        const foundIndex = line.indexOf(normalizedQuery, fromIndex);
        if (foundIndex === -1) {
          break;
        }
        matchPositions.push({ row, column: foundIndex });
        fromIndex = foundIndex + Math.max(queryLength, 1);
      }
    }

    const totalMatchCount = matchPositions.length;

    if (totalMatchCount > 0) {
      const normalizedActiveIndex = ((activeMatchIndex % totalMatchCount) + totalMatchCount) % totalMatchCount;
      const activeMatch = matchPositions[normalizedActiveIndex];
      safeSelectMatch(activeMatch.row, activeMatch.column, queryLength);
      if (scrollToActiveMatch) {
        term.scrollToLine(activeMatch.row);
      }
    } else {
      safeClearSelection();
    }

    onSearchMatchesChange?.(totalMatchCount);
  }, [activeMatchIndex, onSearchMatchesChange, safeClearSelection, safeSelectMatch, searchQuery]);

  // Re-fit when height changes
  useEffect(() => {
    scheduleFitAndResize();
  }, [height, scheduleFitAndResize]);

  // Main terminal lifecycle
  useEffect(() => {
    if (!workingDirectory || !isDesktopRuntime || !terminalContainerRef.current) return;

    disposedRef.current = false;
    setRuntimeStatus('connecting');

    let disposed = false;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let offError: (() => void) | null = null;
    let inputDisposable: { dispose: () => void } | null = null;
    let onWindowResize: (() => void) | null = null;
    let onDocumentVisible: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let renderDisposable: { dispose: () => void } | null = null;
    let layoutReadyTimer: number | null = null;
    let delayedFitTimer: number | null = null;
    let liveDataIdleTimer: number | null = null;
    let snapshotPollTimer: number | null = null;
    let snapshotPollInFlight = false;
    let snapshotPollingStopped = false;
    let pendingSnapshot: string | null = null;
    let pendingOutputBuffer = '';
    let renderedSnapshot = '';

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !terminalContainerRef.current) return;

      const computedStyle = window.getComputedStyle(document.documentElement);
      const bgPrimary = computedStyle.getPropertyValue('--bg-primary').trim() || '#1a1a1a';
      const textPrimary = computedStyle.getPropertyValue('--text-primary').trim() || 'rgba(255, 255, 255, 0.92)';
      const selectionBackground =
        computedStyle.getPropertyValue('--selection-background').trim() || 'rgba(255, 255, 255, 0.22)';

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        allowTransparency: false,
        fontFamily: 'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: terminalFontSize,
        theme: {
          background: bgPrimary,
          foreground: textPrimary,
          cursor: textPrimary,
          selectionBackground,
          selectionInactiveBackground: selectionBackground,
        },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      terminalLayoutReadyRef.current = false;

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      const isTerminalUsable = () => {
        if (disposed) return false;
        if (disposedRef.current) return false;
        if (terminalRef.current !== term) return false;
        if (!terminalContainerRef.current?.isConnected) return false;
        if (!term.element?.isConnected) return false;
        return true;
      };

      const hasRenderableGeometry = () => {
        const container = terminalContainerRef.current;
        const rowsLayer = term.element?.querySelector('.xterm-rows');
        if (!isTerminalUsable() || !container?.isConnected) return false;
        if (!hasTerminalRendererReady(term)) return false;
        if (container.clientWidth < 24 || container.clientHeight < 24) return false;
        if (term.cols > 0 && term.rows > 0) return true;
        if (!(rowsLayer instanceof HTMLElement) || !rowsLayer.isConnected) return false;
        const rowsRect = rowsLayer.getBoundingClientRect();
        return rowsRect.width > 0 && rowsRect.height > 0;
      };

      const canWriteToTerminal = () => isTerminalUsable() && hasTerminalRendererReady(term);

      const flushPendingSnapshot = () => {
        if (!pendingSnapshot || !canWriteToTerminal()) return;
        const snapshot = pendingSnapshot;
        try {
          term.write(snapshot);
          replaceTerminalOutputSnapshot(sessionId, snapshot);
          renderedSnapshot = snapshot;
          if (pendingSnapshot === snapshot) pendingSnapshot = null;
        } catch {
          // Ignore
        }
      };

      const flushPendingOutput = () => {
        if (!pendingOutputBuffer || !canWriteToTerminal()) return;
        const bufferedOutput = pendingOutputBuffer;
        pendingOutputBuffer = '';
        try {
          term.write(bufferedOutput);
          renderedSnapshot += bufferedOutput;
        } catch {
          pendingOutputBuffer = bufferedOutput + pendingOutputBuffer;
        }
      };

      const markTerminalLayoutReady = () => {
        if (disposed || terminalLayoutReadyRef.current || !hasRenderableGeometry()) return;
        terminalLayoutReadyRef.current = true;
        // Don't auto-focus terminal in panel mode — user clicks to focus
        scheduleFitAndResize();
        flushPendingSnapshot();
        flushPendingOutput();
      };

      const queueSnapshotReplay = (snapshot: string) => {
        if (!snapshot || snapshot === renderedSnapshot) return;
        pendingSnapshot = snapshot;
        flushPendingSnapshot();
      };

      const writeToTerminal = (data: string) => {
        if (!data) return;
        if (!canWriteToTerminal()) {
          pendingOutputBuffer += data;
          return;
        }
        try {
          term.write(data);
          renderedSnapshot += data;
        } catch {
          pendingOutputBuffer += data;
        }
      };

      const stopSnapshotPolling = () => {
        if (snapshotPollTimer !== null) {
          window.clearInterval(snapshotPollTimer);
          snapshotPollTimer = null;
        }
      };

      const clearSnapshotPollingFallback = () => {
        if (liveDataIdleTimer !== null) {
          window.clearTimeout(liveDataIdleTimer);
          liveDataIdleTimer = null;
        }
      };

      const syncSnapshotFromBackend = async () => {
        if (disposed || disposedRef.current || snapshotPollingStopped || snapshotPollInFlight) return;
        if (document.visibilityState !== 'visible') return;
        snapshotPollInFlight = true;
        try {
          const result = await window.electronAPI?.terminal?.snapshot({ sessionId });
          if (disposed || snapshotPollingStopped) return;
          const snapshot = result?.snapshot ?? '';
          if (!snapshot) {
            flushPendingSnapshot();
            flushPendingOutput();
            return;
          }
          const cachedOutput = getTerminalOutputSnapshot(sessionId);
          if (snapshot === cachedOutput) {
            flushPendingSnapshot();
            flushPendingOutput();
            return;
          }
          if (cachedOutput && snapshot.startsWith(cachedOutput)) {
            const delta = snapshot.slice(cachedOutput.length);
            if (delta) {
              appendTerminalOutputSnapshot(sessionId, delta);
              writeToTerminal(delta);
            }
          } else {
            replaceTerminalOutputSnapshot(sessionId, snapshot);
            pendingOutputBuffer = '';
            pendingSnapshot = snapshot;
            renderedSnapshot = '';
            if (hasTerminalRendererReady(term)) {
              try { term.reset(); } catch { /* ignore */ }
            }
            flushPendingSnapshot();
            flushPendingOutput();
          }
          setRuntimeStatus('connected');
          setTerminalRuntimeStatusSnapshot(sessionId, 'connected');
        } catch {
          // ignore
        } finally {
          snapshotPollInFlight = false;
        }
      };

      const armSnapshotPollingFallback = (delay = SNAPSHOT_IDLE_GRACE_MS) => {
        if (disposed || snapshotPollingStopped) return;
        stopSnapshotPolling();
        clearSnapshotPollingFallback();
        liveDataIdleTimer = window.setTimeout(() => {
          liveDataIdleTimer = null;
          if (disposed || snapshotPollingStopped) return;
          void syncSnapshotFromBackend();
          if (snapshotPollTimer === null) {
            snapshotPollTimer = window.setInterval(() => {
              void syncSnapshotFromBackend();
            }, SNAPSHOT_POLL_INTERVAL_MS);
          }
        }, delay);
      };

      renderDisposable = term.onRender(() => {
        markTerminalLayoutReady();
        flushPendingSnapshot();
        flushPendingOutput();
      });

      layoutReadyTimer = window.setTimeout(() => {
        if (disposed) return;
        markTerminalLayoutReady();
        scheduleFitAndResize();
        flushPendingSnapshot();
        flushPendingOutput();
      }, 80);

      const cachedStatus = getTerminalRuntimeStatusSnapshot(sessionId);
      if (cachedStatus) {
        setRuntimeStatus(cachedStatus);
      } else {
        setTerminalRuntimeStatusSnapshot(sessionId, 'connecting');
      }
      const cachedOutput = getTerminalOutputSnapshot(sessionId);
      const bootstrappedFromCache = Boolean(cachedOutput);
      let receivedLiveData = false;
      let skipFirstLiveChunk = bootstrappedFromCache;

      if (cachedOutput) {
        queueSnapshotReplay(cachedOutput);
      }

      offData = window.electronAPI!.terminal.onData((event) => {
        if (disposed || disposedRef.current || event.sessionId !== sessionId) return;
        receivedLiveData = true;
        armSnapshotPollingFallback();
        markTerminalLayoutReady();
        flushPendingSnapshot();
        let dataToWrite = event.data;
        if (skipFirstLiveChunk) {
          skipFirstLiveChunk = false;
          if (dataToWrite.length > 0 && renderedSnapshot.endsWith(dataToWrite)) {
            dataToWrite = '';
          }
        }
        if (dataToWrite) {
          appendTerminalOutputSnapshot(sessionId, dataToWrite);
          writeToTerminal(dataToWrite);
        }
        setRuntimeStatus('connected');
        setTerminalRuntimeStatusSnapshot(sessionId, 'connected');
      });

      offExit = window.electronAPI!.terminal.onExit((event) => {
        if (disposed || disposedRef.current || event.sessionId !== sessionId) return;
        snapshotPollingStopped = true;
        clearSnapshotPollingFallback();
        stopSnapshotPolling();
        setRuntimeStatus('closed');
        setTerminalRuntimeStatusSnapshot(sessionId, 'closed');
        const closedNotice = '\r\n\x1b[33m[terminal closed]\x1b[0m\r\n';
        appendTerminalOutputSnapshot(sessionId, closedNotice);
        writeToTerminal(closedNotice);
      });

      offError = window.electronAPI!.terminal.onError((event) => {
        if (disposed || disposedRef.current || event.sessionId !== sessionId) return;
        snapshotPollingStopped = true;
        clearSnapshotPollingFallback();
        stopSnapshotPolling();
        setRuntimeStatus('error');
        setTerminalRuntimeStatusSnapshot(sessionId, 'error');
        const errorNotice = `\r\n\x1b[31m[terminal error] ${event.error}\x1b[0m\r\n`;
        appendTerminalOutputSnapshot(sessionId, errorNotice);
        writeToTerminal(errorNotice);
      });

      inputDisposable = term.onData((input) => {
        if (disposed || disposedRef.current) return;
        window.electronAPI?.terminal?.write({ sessionId, data: input }).catch(() => {});
      });

      window.electronAPI
        ?.terminal
        ?.open({
          sessionId,
          cwd: workingDirectory,
          cols: term.cols || 80,
          rows: term.rows || 24,
        })
        .then((result) => {
          if (disposed) return;
          if (!bootstrappedFromCache && !receivedLiveData && result?.snapshot) {
            queueSnapshotReplay(result.snapshot);
          }
          setRuntimeStatus('connected');
          setTerminalRuntimeStatusSnapshot(sessionId, 'connected');
          markTerminalLayoutReady();
          scheduleFitAndResize();
          flushPendingSnapshot();
          flushPendingOutput();
          void syncSnapshotFromBackend();
          armSnapshotPollingFallback();
        })
        .catch((err) => {
          if (disposed) return;
          snapshotPollingStopped = true;
          clearSnapshotPollingFallback();
          stopSnapshotPolling();
          setRuntimeStatus('error');
          setTerminalRuntimeStatusSnapshot(sessionId, 'error');
          const message = err instanceof Error ? err.message : String(err);
          const openFailedNotice = `\r\n\x1b[31m[open failed] ${message}\x1b[0m\r\n`;
          appendTerminalOutputSnapshot(sessionId, openFailedNotice);
          writeToTerminal(openFailedNotice);
        });

      onWindowResize = () => {
        markTerminalLayoutReady();
        scheduleFitAndResize();
        flushPendingSnapshot();
        flushPendingOutput();
        void syncSnapshotFromBackend();
      };
      window.addEventListener('resize', onWindowResize);

      onDocumentVisible = () => {
        if (document.visibilityState === 'visible') {
          markTerminalLayoutReady();
          scheduleFitAndResize();
          flushPendingSnapshot();
          flushPendingOutput();
          void syncSnapshotFromBackend();
        }
      };
      document.addEventListener('visibilitychange', onDocumentVisible);

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          markTerminalLayoutReady();
          scheduleFitAndResize();
          flushPendingSnapshot();
          flushPendingOutput();
        });
        resizeObserver.observe(terminalContainerRef.current);
      }

      delayedFitTimer = window.setTimeout(() => {
        markTerminalLayoutReady();
        scheduleFitAndResize();
        flushPendingSnapshot();
        flushPendingOutput();
        void syncSnapshotFromBackend();
      }, 120);
    })();

    return () => {
      disposedRef.current = true;
      disposed = true;
      offData?.();
      offExit?.();
      offError?.();
      inputDisposable?.dispose();
      if (onWindowResize) window.removeEventListener('resize', onWindowResize);
      if (onDocumentVisible) document.removeEventListener('visibilitychange', onDocumentVisible);
      if (resizeObserver) resizeObserver.disconnect();
      renderDisposable?.dispose();
      if (layoutReadyTimer !== null) window.clearTimeout(layoutReadyTimer);
      if (delayedFitTimer !== null) window.clearTimeout(delayedFitTimer);
      if (liveDataIdleTimer !== null) window.clearTimeout(liveDataIdleTimer);
      if (snapshotPollTimer !== null) window.clearInterval(snapshotPollTimer);
      if (fitRafRef.current !== null) {
        window.cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = null;
      }
      if (fitTimeoutRef.current !== null) {
        window.clearTimeout(fitTimeoutRef.current);
        fitTimeoutRef.current = null;
      }
      pendingSnapshot = null;
      pendingOutputBuffer = '';
      terminalLayoutReadyRef.current = false;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, isDesktopRuntime, scheduleFitAndResize, workingDirectory, terminalFontSize]);

  // Search highlighting for terminal output rows.
  useEffect(() => {
    searchObserverRef.current?.disconnect();
    searchObserverRef.current = null;

    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery || !isDesktopRuntime) {
      clearSearchHighlights();
      return;
    }

    applySearchHighlights(true);

    const container = terminalContainerRef.current;
    const rowsLayer = container?.querySelector('.xterm-rows');
    if (!(rowsLayer instanceof HTMLElement)) {
      return;
    }

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        applySearchHighlights(false);
      });
    });
    observer.observe(rowsLayer, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    searchObserverRef.current = observer;

    return () => {
      observer.disconnect();
    };
  }, [activeMatchIndex, applySearchHighlights, clearSearchHighlights, isDesktopRuntime, searchQuery]);

  useEffect(() => {
    return () => {
      searchObserverRef.current?.disconnect();
      searchObserverRef.current = null;
    };
  }, []);

  // Update terminal font size when fontScale changes
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    if (!hasTerminalRendererReady(term)) {
      return;
    }
    if (term.options.fontSize !== terminalFontSize) {
      try {
        term.options.fontSize = terminalFontSize;
      } catch {
        return;
      }
      scheduleFitAndResize();
    }
  }, [scheduleFitAndResize, terminalFontSize]);

  if (!isDesktopRuntime) return null;

  const statusLabel =
    runtimeStatus === 'connected'
      ? t('terminal.statusConnected')
      : runtimeStatus === 'connecting'
      ? t('terminal.statusConnecting')
      : runtimeStatus === 'closed'
      ? t('terminal.statusClosed')
      : t('terminal.statusError');

  const statusColor =
    runtimeStatus === 'connected'
      ? 'bg-green-500'
      : runtimeStatus === 'connecting'
      ? 'bg-yellow-500'
      : runtimeStatus === 'closed'
      ? 'bg-gray-500'
      : 'bg-red-500';

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border-subtle"
      style={{ height }}
    >
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between px-3 bg-bg-secondary/50">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TerminalIcon className="h-3.5 w-3.5" />
          <span className="font-medium">{t('terminalPanel.terminal')}</span>
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', statusColor)} />
          <span className="text-[10px]">{statusLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          {onToggle && (
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-bg-hover hover:text-foreground"
              onClick={onToggle}
              aria-label={t('terminalPanel.collapse')}
              title={t('terminalPanel.collapse')}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3" />
            </button>
          )}
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-bg-hover hover:text-foreground"
            onClick={handleClosePanel}
            aria-label={t('terminalPanel.close')}
            title={t('terminalPanel.close')}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Terminal container */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={terminalContainerRef}
          className="terminal-xterm-shell h-full w-full"
          style={{ backgroundColor: 'var(--bg-primary)' }}
          onMouseDown={() => terminalRef.current?.focus()}
          onTouchStart={() => terminalRef.current?.focus()}
        />
      </div>
    </div>
  );
}
