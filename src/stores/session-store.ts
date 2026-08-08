import { create } from 'zustand';
import type { SessionType } from '@/types';

interface SessionStoreState {
  currentSessionId: string | null;
  currentSessionType: SessionType | null;
  setCurrentSession: (sessionId: string, sessionType?: SessionType) => void;
  clearCurrentSession: () => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
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
    }));
