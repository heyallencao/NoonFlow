'use client';

import { useEffect } from 'react';
import { useRuntimeStore } from '@/stores/runtime-store';
import {
  getActiveSessionIds,
  getSnapshot,
  subscribeGlobal,
} from '@/lib/stream-session-manager';

/**
 * Global stream-to-runtime-store synchronization.
 *
 * This component ensures that runtime snapshots are always kept in sync
 * with the stream-session-manager, even when individual ChatView components
 * are unmounted (e.g., when switching tabs).
 *
 * Without this, tab status indicators would show stale "running" states
 * for sessions that have already completed in the background.
 */
export function StreamRuntimeSync() {
  const setSessionSnapshot = useRuntimeStore((state) => state.setSessionSnapshot);

  useEffect(() => {
    for (const sessionId of getActiveSessionIds()) {
      const snapshot = getSnapshot(sessionId);
      if (snapshot) {
        setSessionSnapshot(snapshot);
      }
    }

    // Subscribe to all stream events globally
    const unsubscribe = subscribeGlobal((event) => {
      // Always update the runtime store with the latest snapshot
      setSessionSnapshot(event.snapshot);
    });

    return () => {
      unsubscribe();
    };
  }, [setSessionSnapshot]);

  // This component doesn't render anything
  return null;
}
