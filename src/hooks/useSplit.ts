"use client";

import { createContext, useContext } from "react";

export interface SplitSession {
  sessionId: string;
  title: string;
  workingDirectory: string;
  projectName: string;
  mode?: string;
}

export interface SplitContextValue {
  splitSessions: SplitSession[];
  activeColumnId: string;
  isSplitActive: boolean;
  addToSplit: (session: SplitSession) => void;
  removeFromSplit: (sessionId: string) => void;
  setActiveColumn: (sessionId: string) => void;
  exitSplit: () => void;
  isInSplit: (sessionId: string) => boolean;
}

export const SplitContext = createContext<SplitContextValue | null>(null);

export function useSplit(): SplitContextValue {
  const ctx = useContext(SplitContext);
  if (!ctx) {
    throw new Error("useSplit must be used within a SplitProvider");
  }
  return ctx;
}
