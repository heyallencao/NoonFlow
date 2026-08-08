import {
  getMediaJob,
  getMediaJobItems,
  getPendingJobItems,
  updateMediaJobStatus,
  updateMediaJobItem,
  updateMediaJobCounters,
  cancelPendingJobItems,
} from '@/lib/db';
import { generateSingleImage } from '@/lib/image-generator';
import type { BatchConfig, JobProgressEvent, MediaJobItem } from '@/types';

// ==========================================
// globalThis Singleton (survives hot reload)
// ==========================================

interface RunningJob {
  jobId: string;
  abortController: AbortController;
  progressListeners: Set<(event: JobProgressEvent) => void>;
  config: BatchConfig;
  activeCount: number;
  isRunning: boolean;
}

const GLOBAL_KEY = '__mediaJobExecutor__' as const;

function getRunningJobs(): Map<string, RunningJob> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, RunningJob>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, RunningJob>;
}

const DEFAULT_CONFIG: BatchConfig = {
  concurrency: 2,
  maxRetries: 2,
  retryDelayMs: 2000,
};

// ==========================================
// Progress Listener Management
// ==========================================

export function addProgressListener(jobId: string, listener: (event: JobProgressEvent) => void): () => void {
  const running = getRunningJobs().get(jobId);
  if (running) {
    running.progressListeners.add(listener);
  }
  // Return cleanup function
  return () => {
    const r = getRunningJobs().get(jobId);
    if (r) {
      r.progressListeners.delete(listener);
    }
  };
}

function emitProgress(jobId: string, event: JobProgressEvent): void {
  const running = getRunningJobs().get(jobId);
  if (!running) return;
  for (const listener of running.progressListeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[job-executor] Progress listener error:', err);
    }
  }
}

function buildProgressSnapshot(jobId: string): JobProgressEvent['progress'] {
  const items = getMediaJobItems(jobId);
  return {
    total: items.length,
    completed: items.filter(i => i.status === 'completed').length,
    failed: items.filter(i => i.status === 'failed').length,
    processing: items.filter(i => i.status === 'processing').length,
  };
}

// ==========================================
// Core Executor
// ==========================================

/**
 * Start executing a job. Transitions job to 'running' and processes items with concurrency control.
 */
export async function startJob(jobId: string): Promise<void> {
  const job = getMediaJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== 'planned' && job.status !== 'paused') {
    throw new Error(`Job ${jobId} cannot be started from status "${job.status}"`);
  }

  // Parse batch config
  let config: BatchConfig;
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(job.batch_config) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }

  const abortController = new AbortController();
  const runningJob: RunningJob = {
    jobId,
    abortController,
    progressListeners: new Set(),
    config,
    activeCount: 0,
    isRunning: true,
  };

  // Preserve existing listeners if resuming
  const existing = getRunningJobs().get(jobId);
  if (existing) {
    for (const listener of existing.progressListeners) {
      runningJob.progressListeners.add(listener);
    }
  }

  getRunningJobs().set(jobId, runningJob);
  updateMediaJobStatus(jobId, 'running');

  // Execute the queue
  try {
    await executeQueue(runningJob);
  } catch (err) {
    console.error(`[job-executor] Job ${jobId} queue error:`, err);
  }
}

async function executeQueue(runningJob: RunningJob): Promise<void> {
  const { jobId, config } = runningJob;

  while (runningJob.isRunning) {
    // Get items that need processing
    const pending = getPendingJobItems(jobId, config.maxRetries);
    if (pending.length === 0 && runningJob.activeCount === 0) {
      break; // All done
    }
    if (pending.length === 0) {
      // Wait for active items to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }

    // Fill up to concurrency limit
    while (runningJob.isRunning && runningJob.activeCount < config.concurrency) {
      const nextItems = getPendingJobItems(jobId, config.maxRetries);
      const nextItem = nextItems.find(i => i.status === 'pending' || i.status === 'failed');
      if (!nextItem) break;

      runningJob.activeCount++;
      processItem(runningJob, nextItem).finally(() => {
        runningJob.activeCount--;
      });
    }

    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Finalize the job
  finalizeJob(jobId);
}

async function processItem(runningJob: RunningJob, item: MediaJobItem): Promise<void> {
  const { jobId, abortController, config } = runningJob;
  const now = new Date().toISOString();

  // If this is a retry, wait with exponential backoff
  if (item.retry_count > 0) {
    const delay = config.retryDelayMs * Math.pow(3, item.retry_count - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Check if still running after delay
    if (!runningJob.isRunning || abortController.signal.aborted) return;
  }

  // Mark as processing
  updateMediaJobItem(item.id, { status: 'processing' });

  emitProgress(jobId, {
    type: 'item_started',
    jobId,
    itemId: item.id,
    itemIdx: item.idx,
    progress: buildProgressSnapshot(jobId),
    timestamp: now,
  });

  try {
    const result = await generateSingleImage({
      prompt: item.prompt,
      aspectRatio: item.aspect_ratio,
      imageSize: item.image_size,
      model: item.model || undefined,
      sessionId: getMediaJob(jobId)?.session_id || undefined,
      abortSignal: abortController.signal,
    });

    // Success
    updateMediaJobItem(item.id, {
      status: 'completed',
      resultMediaGenerationId: result.mediaGenerationId,
      error: null,
    });
    updateMediaJobCounters(jobId);

    emitProgress(jobId, {
      type: 'item_completed',
      jobId,
      itemId: item.id,
      itemIdx: item.idx,
      progress: buildProgressSnapshot(jobId),
      mediaGenerationId: result.mediaGenerationId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const statusCode = extractStatusCode(err);
    const isNonRetryable = statusCode !== undefined && [400, 401, 403].includes(statusCode);
    const retriesExhausted = item.retry_count + 1 >= config.maxRetries;

    if (isNonRetryable || retriesExhausted) {
      // Mark as failed permanently
      updateMediaJobItem(item.id, {
        status: 'failed',
        retryCount: item.retry_count + 1,
        error: errorMessage,
      });
      updateMediaJobCounters(jobId);

      emitProgress(jobId, {
        type: 'item_failed',
        jobId,
        itemId: item.id,
        itemIdx: item.idx,
        progress: buildProgressSnapshot(jobId),
        error: errorMessage,
        retryCount: item.retry_count + 1,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Mark for retry
      updateMediaJobItem(item.id, {
        status: 'failed',
        retryCount: item.retry_count + 1,
        error: errorMessage,
      });

      emitProgress(jobId, {
        type: 'item_retry',
        jobId,
        itemId: item.id,
        itemIdx: item.idx,
        progress: buildProgressSnapshot(jobId),
        error: errorMessage,
        retryCount: item.retry_count + 1,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

function finalizeJob(jobId: string): void {
  const job = getMediaJob(jobId);
  if (!job) return;

  // Only finalize if the job was still running (not paused/cancelled externally)
  if (job.status !== 'running') return;

  updateMediaJobCounters(jobId);
  const updatedJob = getMediaJob(jobId);
  if (!updatedJob) return;

  const items = getMediaJobItems(jobId);
  const allDone = items.every(i => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled');

  if (allDone) {
    const hasFailures = items.some(i => i.status === 'failed');
    const finalStatus = hasFailures && updatedJob.completed_items === 0 ? 'failed' : 'completed';
    updateMediaJobStatus(jobId, finalStatus);

    emitProgress(jobId, {
      type: 'job_completed',
      jobId,
      progress: buildProgressSnapshot(jobId),
      timestamp: new Date().toISOString(),
    });
  }

  // Cleanup
  getRunningJobs().delete(jobId);
}

// ==========================================
// Control Operations
// ==========================================

/**
 * Pause a running job. Current items finish but no new items start.
 */
export function pauseJob(jobId: string): void {
  const running = getRunningJobs().get(jobId);
  if (!running) throw new Error(`Job ${jobId} is not running`);

  running.isRunning = false;
  updateMediaJobStatus(jobId, 'paused');

  emitProgress(jobId, {
    type: 'job_paused',
    jobId,
    progress: buildProgressSnapshot(jobId),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Cancel a running or paused job.
 */
export function cancelJob(jobId: string): void {
  const running = getRunningJobs().get(jobId);
  if (running) {
    running.isRunning = false;
    running.abortController.abort();
  }

  cancelPendingJobItems(jobId);
  updateMediaJobStatus(jobId, 'cancelled');

  emitProgress(jobId, {
    type: 'job_cancelled',
    jobId,
    progress: buildProgressSnapshot(jobId),
    timestamp: new Date().toISOString(),
  });

  getRunningJobs().delete(jobId);
}

/**
 * Check if a job is currently running in memory.
 */
export function isJobRunning(jobId: string): boolean {
  return getRunningJobs().has(jobId);
}

// ==========================================
// Helpers
// ==========================================

function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status;
  }
  if (err instanceof Error && err.message) {
    const match = err.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1]);
  }
  return undefined;
}
