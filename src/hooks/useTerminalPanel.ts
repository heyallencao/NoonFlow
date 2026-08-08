'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const TERMINAL_PANEL_MIN_HEIGHT = 150;
const TERMINAL_PANEL_MAX_HEIGHT = 600;
const TERMINAL_PANEL_DEFAULT_HEIGHT = 280;

function storageKey(workspace: string) {
  return `noonflow:terminal-panel:${workspace}`;
}

function legacyStorageKeys(workspace: string) {
  return [`monolith:terminal-panel:${workspace}`];
}

interface TerminalPanelState {
  isOpen: boolean;
  height: number;
  terminalSessionId: string | null;
}

function loadPersistedState(workspace: string): { isOpen: boolean; height: number; sessionId: string | null } {
  if (!workspace || typeof window === 'undefined') {
    return { isOpen: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT, sessionId: null };
  }
  try {
    const raw = readCompatibleStorageValue(
      getLocalStorageSafe(),
      storageKey(workspace),
      legacyStorageKeys(workspace),
    );
    if (!raw) return { isOpen: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT, sessionId: null };
    const parsed = JSON.parse(raw);
    return {
      isOpen: Boolean(parsed.isOpen),
      height: clampHeight(parsed.height ?? TERMINAL_PANEL_DEFAULT_HEIGHT),
      sessionId: parsed.sessionId ?? null,
    };
  } catch {
    return { isOpen: false, height: TERMINAL_PANEL_DEFAULT_HEIGHT, sessionId: null };
  }
}

function persistState(workspace: string, state: { isOpen: boolean; height: number; sessionId: string | null }) {
  if (!workspace || typeof window === 'undefined') return;
  try {
    writeStorageValue(getLocalStorageSafe(), storageKey(workspace), JSON.stringify(state));
  } catch {
    // best effort
  }
}

function clampHeight(h: number): number {
  return Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.min(TERMINAL_PANEL_MAX_HEIGHT, h));
}

export function useTerminalPanel(workspace: string) {
  const [state, setState] = useState<TerminalPanelState>(() => {
    const persisted = loadPersistedState(workspace);
    return {
      isOpen: persisted.isOpen,
      height: persisted.height,
      terminalSessionId: persisted.sessionId,
    };
  });

  const creatingRef = useRef(false);

  const isTerminalSessionValid = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) return false;
      const data = await res.json().catch(() => null) as { session?: { session_type?: string; status?: string } } | null;
      const session = data?.session;
      if (!session) return false;
      return session.session_type === 'terminal' && session.status === 'active';
    } catch {
      return false;
    }
  }, []);

  // Re-load when workspace changes
  useEffect(() => {
    const persisted = loadPersistedState(workspace);
    setState({
      isOpen: persisted.isOpen,
      height: persisted.height,
      terminalSessionId: persisted.sessionId,
    });

    if (!persisted.sessionId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const valid = await isTerminalSessionValid(persisted.sessionId || '');
      if (cancelled || valid) return;
      setState((prev) => ({
        ...prev,
        isOpen: false,
        terminalSessionId: null,
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [isTerminalSessionValid, workspace]);

  // Persist state changes
  useEffect(() => {
    persistState(workspace, {
      isOpen: state.isOpen,
      height: state.height,
      sessionId: state.terminalSessionId,
    });
  }, [workspace, state.isOpen, state.height, state.terminalSessionId]);

  const ensureTerminalSession = useCallback(async () => {
    if (creatingRef.current || !workspace) return state.terminalSessionId;
    if (state.terminalSessionId) {
      const valid = await isTerminalSessionValid(state.terminalSessionId);
      if (valid) {
        return state.terminalSessionId;
      }
      setState((prev) => ({ ...prev, isOpen: false, terminalSessionId: null }));
    }

    creatingRef.current = true;
    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_directory: workspace,
          model: '',
          provider_id: '',
          session_type: 'terminal',
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const sessionId: string = data.session?.id;
      if (!sessionId) return null;
      setState((prev) => ({ ...prev, terminalSessionId: sessionId }));
      return sessionId;
    } catch {
      return null;
    } finally {
      creatingRef.current = false;
    }
  }, [workspace, state.terminalSessionId, isTerminalSessionValid]);

  const togglePanel = useCallback(async () => {
    if (state.isOpen) {
      setState((prev) => ({ ...prev, isOpen: false }));
    } else {
      await ensureTerminalSession();
      setState((prev) => ({ ...prev, isOpen: true }));
    }
  }, [state.isOpen, ensureTerminalSession]);

  const closePanel = useCallback(async () => {
    const terminalSessionId = state.terminalSessionId;
    // Clear the terminal session and close the panel first to unmount TerminalPanel promptly.
    setState((prev) => ({ ...prev, isOpen: false, terminalSessionId: null }));
    // Best-effort backend close after UI teardown.
    if (terminalSessionId && typeof window !== 'undefined' && window.electronAPI?.terminal) {
      void window.electronAPI.terminal.close({ sessionId: terminalSessionId }).catch(() => {
        // Ignore errors when closing terminal
      });
    }
  }, [state.terminalSessionId]);

  const setHeight = useCallback((h: number) => {
    setState((prev) => ({ ...prev, height: clampHeight(h) }));
  }, []);

  const resizeByDelta = useCallback((delta: number) => {
    setState((prev) => ({ ...prev, height: clampHeight(prev.height - delta) }));
  }, []);

  return {
    isOpen: state.isOpen,
    height: state.height,
    terminalSessionId: state.terminalSessionId,
    togglePanel,
    closePanel,
    setHeight,
    resizeByDelta,
  };
}

export { TERMINAL_PANEL_MIN_HEIGHT, TERMINAL_PANEL_MAX_HEIGHT, TERMINAL_PANEL_DEFAULT_HEIGHT };
