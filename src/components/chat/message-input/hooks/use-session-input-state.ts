import { useCallback, useEffect, useState } from 'react';
import { appendChatInputHistory } from '@/lib/chat-input-history';
import { subscribeSessionTabClosed } from '@/lib/events/app-event-bus';
import { subscribeSessionRefresh } from '@/lib/events/session-refresh-hub';
import {
  DRAFT_BY_SESSION,
  INPUT_HISTORY_BY_SESSION,
  getSessionScopedInputKey,
} from '../session-state';

interface UseSessionInputStateResult {
  inputValue: string;
  setInputValue: (value: string) => void;
  historyIndex: number | null;
  setHistoryIndex: (index: number | null) => void;
  historyDraftBeforeNavigation: string;
  setHistoryDraftBeforeNavigation: (value: string) => void;
  clearHistoryNavigationState: () => void;
  commitInputToHistory: (value: string) => void;
}

interface SessionInputState {
  inputValue: string;
  historyIndex: number | null;
  historyDraftBeforeNavigation: string;
}

function getInitialSessionInputState(sessionId?: string): SessionInputState {
  return {
    inputValue: DRAFT_BY_SESSION.get(getSessionScopedInputKey(sessionId)) || '',
    historyIndex: null,
    historyDraftBeforeNavigation: '',
  };
}

export function useSessionInputState(sessionId?: string): UseSessionInputStateResult {
  const sessionKey = getSessionScopedInputKey(sessionId);
  const [sessionStateByKey, setSessionStateByKey] = useState<Record<string, SessionInputState>>(() => ({
    [sessionKey]: getInitialSessionInputState(sessionId),
  }));

  const activeState = sessionStateByKey[sessionKey] ?? getInitialSessionInputState(sessionId);
  const inputValue = activeState.inputValue;
  const historyIndex = activeState.historyIndex;
  const historyDraftBeforeNavigation = activeState.historyDraftBeforeNavigation;

  const updateActiveState = useCallback(
    (updater: (prev: SessionInputState) => SessionInputState) => {
      setSessionStateByKey((prev) => {
        const current = prev[sessionKey] ?? getInitialSessionInputState(sessionId);
        return {
          ...prev,
          [sessionKey]: updater(current),
        };
      });
    },
    [sessionId, sessionKey]
  );

  const setInputValue = useCallback(
    (value: string) => {
      updateActiveState((prev) => ({ ...prev, inputValue: value }));
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        DRAFT_BY_SESSION.delete(sessionKey);
        return;
      }
      DRAFT_BY_SESSION.set(sessionKey, value);
    },
    [sessionKey, updateActiveState]
  );

  const setHistoryIndex = useCallback(
    (index: number | null) => {
      updateActiveState((prev) => ({ ...prev, historyIndex: index }));
    },
    [updateActiveState]
  );

  const setHistoryDraftBeforeNavigation = useCallback(
    (value: string) => {
      updateActiveState((prev) => ({ ...prev, historyDraftBeforeNavigation: value }));
    },
    [updateActiveState]
  );

  const clearHistoryNavigationState = useCallback(() => {
    updateActiveState((prev) => ({
      ...prev,
      historyIndex: null,
      historyDraftBeforeNavigation: '',
    }));
  }, [updateActiveState]);

  const commitInputToHistory = useCallback((value: string) => {
    const normalizedValue = value.trim();
    clearHistoryNavigationState();
    if (!normalizedValue) {
      return;
    }

    const inputKey = getSessionScopedInputKey(sessionId);
    const currentHistory = INPUT_HISTORY_BY_SESSION.get(inputKey) || [];
    INPUT_HISTORY_BY_SESSION.set(inputKey, appendChatInputHistory(currentHistory, normalizedValue));
  }, [clearHistoryNavigationState, sessionId]);

  useEffect(() => {
    const clearSessionInputState = (sessionIds: string[]) => {
      const sessionKeys = sessionIds.map((sid) => getSessionScopedInputKey(sid));
      for (const sid of sessionIds) {
        const inputKey = getSessionScopedInputKey(sid);
        DRAFT_BY_SESSION.delete(inputKey);
        INPUT_HISTORY_BY_SESSION.delete(inputKey);
      }
      setSessionStateByKey((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of sessionKeys) {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const unsubscribeTabClosed = subscribeSessionTabClosed((detail) => {
      if (!detail?.sessionId) return;
      clearSessionInputState([detail.sessionId]);
    });

    const unsubscribeSessionRefresh = subscribeSessionRefresh((detail) => {
      if (detail.type !== 'deleted') return;
      const ids = detail.sessionIds ?? (detail.sessionId ? [detail.sessionId] : []);
      if (ids.length === 0) return;
      clearSessionInputState(ids);
    });

    return () => {
      unsubscribeTabClosed();
      unsubscribeSessionRefresh();
    };
  }, []);

  return {
    inputValue,
    setInputValue,
    historyIndex,
    setHistoryIndex,
    historyDraftBeforeNavigation,
    setHistoryDraftBeforeNavigation,
    clearHistoryNavigationState,
    commitInputToHistory,
  };
}
