"use client";

import { createContext, useContext } from "react";

export interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string;
  downloadProgress: number | null;
  readyToInstall: boolean;
  isNativeUpdate: boolean;
  lastError: string | null;
}

export interface UpdateContextValue {
  updateInfo: UpdateInfo | null;
  checking: boolean;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => void;
  dismissUpdate: () => void;
  showDialog: boolean;
  setShowDialog: (v: boolean) => void;
  quitAndInstall: () => void;
}

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error("useUpdate must be used within an UpdateProvider");
  }
  return ctx;
}
