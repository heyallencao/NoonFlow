import type { MessageContentBlock } from '@/types';

export type CheckpointTerminalStatus = 'completed' | 'error';

export interface CheckpointSnapshot {
  blocks: MessageContentBlock[];
  revision: number;
  isFinal: boolean;
  terminalStatus?: CheckpointTerminalStatus;
}

interface CheckpointFlusherOptions {
  getSnapshot: () => MessageContentBlock[];
  persistSnapshot: (snapshot: CheckpointSnapshot) => Promise<void> | void;
  flushIntervalMs?: number;
  textThresholdChars?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  onDegraded?: (error: unknown) => void;
}

export interface CheckpointFlusher {
  markDirty: (options?: { immediate?: boolean; textDelta?: number }) => void;
  finalize: (status: CheckpointTerminalStatus) => Promise<void>;
  dispose: () => Promise<void>;
  isDegraded: () => boolean;
}

function cloneBlocks(blocks: MessageContentBlock[]): MessageContentBlock[] {
  return blocks.map((block) => structuredClone(block));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createCheckpointFlusher(options: CheckpointFlusherOptions): CheckpointFlusher {
  const flushIntervalMs = options.flushIntervalMs ?? 800;
  const textThresholdChars = options.textThresholdChars ?? 2048;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 50;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let bufferedTextChars = 0;
  let dirty = false;
  let pendingFinalStatus: CheckpointTerminalStatus | null = null;
  let revision = 0;
  let drainPromise: Promise<void> | null = null;
  let degraded = false;

  const clearTimer = () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  };

  const persistWithRetry = async (snapshot: CheckpointSnapshot): Promise<void> => {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt <= maxRetries) {
      try {
        await options.persistSnapshot(snapshot);
        return;
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt > maxRetries) {
          degraded = true;
          options.onDegraded?.(error);
          return;
        }
        await delay(retryDelayMs * attempt);
      }
    }

    degraded = true;
    options.onDegraded?.(lastError);
  };

  const scheduleDrain = (): Promise<void> => {
    if (drainPromise) {
      return drainPromise;
    }

    // Defer the drain body until after drainPromise has been assigned. An
    // immediate empty snapshot can otherwise complete synchronously and set
    // drainPromise to null before this assignment stores the resolved promise.
    drainPromise = Promise.resolve().then(async () => {
      try {
        while (dirty || pendingFinalStatus) {
          clearTimer();

          const isFinal = pendingFinalStatus !== null;
          const terminalStatus = pendingFinalStatus ?? undefined;
          const snapshotBlocks = cloneBlocks(options.getSnapshot());

          dirty = false;
          pendingFinalStatus = null;
          bufferedTextChars = 0;

          if (!isFinal && snapshotBlocks.length === 0) {
            continue;
          }

          revision += 1;
          await persistWithRetry({
            blocks: snapshotBlocks,
            revision,
            isFinal,
            terminalStatus,
          });
        }
      } finally {
        drainPromise = null;
        if (dirty || pendingFinalStatus) {
          void scheduleDrain();
        }
      }
    });

    return drainPromise;
  };

  const ensureTimer = () => {
    if (timer || pendingFinalStatus) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      if (!dirty) {
        return;
      }
      void scheduleDrain();
    }, flushIntervalMs);
  };

  return {
    markDirty({ immediate = false, textDelta = 0 } = {}) {
      dirty = true;
      bufferedTextChars += Math.max(0, textDelta);

      if (immediate || bufferedTextChars >= textThresholdChars) {
        clearTimer();
        void scheduleDrain();
        return;
      }

      ensureTimer();
    },

    finalize(status) {
      dirty = true;
      pendingFinalStatus = status;
      clearTimer();
      return scheduleDrain();
    },

    async dispose() {
      clearTimer();
      if (drainPromise) {
        await drainPromise;
      }
    },

    isDegraded() {
      return degraded;
    },
  };
}
