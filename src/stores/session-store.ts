import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { SessionType } from '@/types';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  removeCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

interface SessionStoreState {
  currentSessionId: string | null;
  currentSessionType: SessionType | null;
  setCurrentSession: (sessionId: string, sessionType?: SessionType) => void;
  clearCurrentSession: () => void;
}

const SESSION_STORE_KEY = 'noonflow-session-store';
const LEGACY_SESSION_STORE_KEYS = ['monolith-session-store'] as const;

const sessionStoreStorage: StateStorage = {
  getItem: (name) =>
    readCompatibleStorageValue(
      getLocalStorageSafe(),
      name,
      name === SESSION_STORE_KEY ? LEGACY_SESSION_STORE_KEYS : [],
    ),
  setItem: (name, value) => {
    writeStorageValue(getLocalStorageSafe(), name, value);
  },
  removeItem: (name) => {
    removeCompatibleStorageValue(
      getLocalStorageSafe(),
      name,
      name === SESSION_STORE_KEY ? LEGACY_SESSION_STORE_KEYS : [],
    );
  },
};

export const useSessionStore = create<SessionStoreState>()(
  persist(
    (set) => ({
      currentSessionId: null,
      currentSessionType: null,
      setCurrentSession: (sessionId, sessionType = 'chat') => {
        set({
          currentSessionId: sessionId,
          currentSessionType: sessionType,
        });
      },
      clearCurrentSession: () => {
        set({
          currentSessionId: null,
          currentSessionType: null,
        });
      },
    }),
    {
      name: SESSION_STORE_KEY,
      storage: createJSONStorage(() => sessionStoreStorage),
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        currentSessionType: state.currentSessionType,
      }),
    },
  ),
);
