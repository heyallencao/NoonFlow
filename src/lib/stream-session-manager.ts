/**
 * Stream Session Manager — client-side singleton that manages SSE streams
 * independently of React component lifecycle.
 *
 * When a user switches sessions, the old ChatView unmounts but the stream
 * continues running here. The new ChatView (or the same one re-mounted)
 * subscribes to get the current snapshot.
 *
 * Uses globalThis pattern (same as conversation-registry.ts) to survive
 * Next.js HMR without losing state.
 */

import { consumeSSEStream } from '@/hooks/useSSEStream';
import type {
  AssistantRuntime,
  ChildActivity,
  ToolUseInfo,
  ToolResultInfo,
  StreamingMessageBlock,
  SessionStreamSnapshot,
  StreamEvent,
  StreamEventListener,
  FileAttachment,
  PermissionRequestEvent,
} from '@/types';
import { retryStrategy, RetryableError } from '@/lib/retry-strategy';
import { publishRefreshFileTree, publishTasksUpdated } from '@/lib/events/app-event-bus';

// ==========================================
// Internal types
// ==========================================

interface ActiveStream {
  sessionId: string;
  abortController: AbortController;
  snapshot: SessionStreamSnapshot;
  listeners: Set<StreamEventListener>;
  idleCheckTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number;
  gcTimer: ReturnType<typeof setTimeout> | null;
  // Mutable accumulators (snapshot gets new object refs on each emit)
  accumulatedText: string;
  accumulatedReasoning: string;
  toolUsesArray: ToolUseInfo[];
  toolResultsArray: ToolResultInfo[];
  childActivitiesArray: ChildActivity[];
  streamingBlocks: StreamingMessageBlock[];
  blockSeq: number;
  toolOutputAccumulated: string;
  toolTimeoutInfo: { toolName: string; elapsedSeconds: number } | null;
  isIdleTimeout: boolean;
  backendStopRequested: boolean;
  // Throttle mechanism for smooth rendering
  throttleTimer: ReturnType<typeof setTimeout> | null;
  pendingEmit: boolean;
  pendingEmitType: StreamEvent['type'] | null;
}

export interface StartStreamParams {
  sessionId: string;
  clientMessageId: string;
  content: string;
  displayContent?: string;
  mode: string;
  model: string;
  providerId: string;
  assistantRuntime: AssistantRuntime;
  files?: FileAttachment[];
  systemPromptAppend?: string;
  pendingImageNotices?: string[];
  /** Called when SDK mode changes (e.g. plan → code) */
  onModeChanged?: (mode: string) => void;
  /** @deprecated Caller compatibility only; ignored so timeout never creates a prompt. */
  sendMessageFn?: (content: string, files?: FileAttachment[], clientMessageId?: string) => void;
}

// ==========================================
// Singleton via globalThis
// ==========================================

const GLOBAL_KEY = '__streamSessionManager__' as const;
const STREAM_IDLE_TIMEOUT_MS = 330_000;
const GC_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const MODEL_FAILURE_FALLBACK_MESSAGE = '模型有问题，调用失败，请稍后重试。';

function buildModelFailureText(detail?: string): string {
  const normalizedDetail = (detail || '').trim();
  if (!normalizedDetail) {
    return MODEL_FAILURE_FALLBACK_MESSAGE;
  }
  return `${MODEL_FAILURE_FALLBACK_MESSAGE}\n\n错误详情：${normalizedDetail}`;
}

function getStreamsMap(): Map<string, ActiveStream> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, ActiveStream>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, ActiveStream>;
}

interface SessionRecoveryResponse {
  session: {
    runtime_status: string;
    runtime_updated_at: string;
  };
  recovery?: {
    pendingPermission?: PermissionRequestEvent | null;
    requiresRestart?: boolean;
    runtimeError?: string;
  };
}

function createEmptySnapshot(sessionId: string): SessionStreamSnapshot {
  return {
    sessionId,
    clientMessageId: null,
    phase: 'completed',
    streamingContent: '',
    streamingReasoning: '',
    toolUses: [],
    toolResults: [],
    childActivities: [],
    streamingBlocks: [],
    streamingToolOutput: '',
    statusText: undefined,
    pendingPermission: null,
    permissionResolved: null,
    tokenUsage: null,
    startedAt: 0,
    completedAt: null,
    error: null,
    persistedUserMessageId: null,
    persistedUserCreatedAt: null,
    persistedMessageId: null,
    persistedRevision: null,
    persistedCreatedAt: null,
    finalMessageContent: null,
  };
}

function createPlaceholderStream(sessionId: string, listeners?: Set<StreamEventListener>): ActiveStream {
  return {
    sessionId,
    abortController: new AbortController(),
    snapshot: createEmptySnapshot(sessionId),
    listeners: listeners ?? new Set(),
    idleCheckTimer: null,
    lastEventTime: 0,
    gcTimer: null,
    accumulatedText: '',
    accumulatedReasoning: '',
    toolUsesArray: [],
    toolResultsArray: [],
    childActivitiesArray: [],
    streamingBlocks: [],
    blockSeq: 0,
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    backendStopRequested: false,
    throttleTimer: null,
    pendingEmit: false,
    pendingEmitType: null,
  };
}

function getOrCreateStream(sessionId: string): ActiveStream {
  const map = getStreamsMap();
  let stream = map.get(sessionId);
  if (!stream) {
    stream = createPlaceholderStream(sessionId);
    map.set(sessionId, stream);
  }
  return stream;
}

function parseRuntimeUpdatedAt(value: string | undefined): number {
  if (!value) {
    return Date.now();
  }
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

// ==========================================
// Helpers
// ==========================================

function buildSnapshot(stream: ActiveStream): SessionStreamSnapshot {
  return {
    sessionId: stream.sessionId,
    clientMessageId: stream.snapshot.clientMessageId,
    phase: stream.snapshot.phase,
    streamingContent: stream.accumulatedText,
    streamingReasoning: stream.accumulatedReasoning,
    toolUses: [...stream.toolUsesArray],
    toolResults: [...stream.toolResultsArray],
    childActivities: [...stream.childActivitiesArray],
    streamingBlocks: [...stream.streamingBlocks],
    streamingToolOutput: stream.toolOutputAccumulated,
    statusText: stream.snapshot.statusText,
    pendingPermission: stream.snapshot.pendingPermission,
    permissionResolved: stream.snapshot.permissionResolved,
    tokenUsage: stream.snapshot.tokenUsage,
    startedAt: stream.snapshot.startedAt,
    completedAt: stream.snapshot.completedAt,
    error: stream.snapshot.error,
    persistedUserMessageId: stream.snapshot.persistedUserMessageId ?? null,
    persistedUserCreatedAt: stream.snapshot.persistedUserCreatedAt ?? null,
    persistedMessageId: stream.snapshot.persistedMessageId ?? null,
    persistedRevision: stream.snapshot.persistedRevision ?? null,
    persistedCreatedAt: stream.snapshot.persistedCreatedAt ?? null,
    finalMessageContent: stream.snapshot.finalMessageContent,
  };
}

function buildTerminalToolResults(
  stream: ActiveStream,
  fallbackIsError = false,
): ToolResultInfo[] {
  const results = [...stream.toolResultsArray];
  const output = stream.toolOutputAccumulated.trim();
  if (!output) {
    return results;
  }

  const hasResultFor = new Set(results.map((item) => item.tool_use_id));
  const pendingTool = [...stream.toolUsesArray]
    .reverse()
    .find((tool) => !hasResultFor.has(tool.id));

  if (pendingTool) {
    results.push({
      tool_use_id: pendingTool.id,
      content: output,
      is_error: fallbackIsError,
    });
    return results;
  }

  // Rare fallback: output arrived before tool_use metadata.
  results.push({
    tool_use_id: `stream-output-${Date.now()}`,
    content: output,
    is_error: fallbackIsError,
  });
  return results;
}

function nextBlockId(stream: ActiveStream, type: StreamingMessageBlock['type']): string {
  stream.blockSeq += 1;
  return `${type}-${stream.blockSeq}`;
}

function resetStreamBuffers(stream: ActiveStream): void {
  stream.accumulatedText = '';
  stream.accumulatedReasoning = '';
  stream.toolUsesArray = [];
  stream.toolResultsArray = [];
  stream.childActivitiesArray = [];
  stream.streamingBlocks = [];
  stream.blockSeq = 0;
  stream.toolOutputAccumulated = '';
  stream.toolTimeoutInfo = null;
  stream.isIdleTimeout = false;
}

function setTerminalTextContent(stream: ActiveStream, nextText: string): void {
  const normalizedNextText = nextText.trim();
  const normalizedCurrentText = stream.accumulatedText.trim();

  if (!normalizedNextText) {
    stream.accumulatedText = '';
    return;
  }

  if (!normalizedCurrentText) {
    stream.accumulatedText = normalizedNextText;
    appendTextLikeBlock(stream, 'text', normalizedNextText);
    return;
  }

  if (normalizedNextText.startsWith(normalizedCurrentText)) {
    const suffix = normalizedNextText.slice(normalizedCurrentText.length);
    stream.accumulatedText = normalizedNextText;
    appendTextLikeBlock(stream, 'text', suffix);
    return;
  }

  const appendedTerminalText = `\n\n${normalizedNextText}`;
  stream.accumulatedText = `${normalizedCurrentText}${appendedTerminalText}`;
  appendTextLikeBlock(stream, 'text', appendedTerminalText);
}

function appendTextLikeBlock(
  stream: ActiveStream,
  type: Extract<StreamingMessageBlock, { type: 'text' | 'reasoning' }>['type'],
  chunk: string,
): void {
  if (!chunk) {
    return;
  }
  const lastBlock = stream.streamingBlocks[stream.streamingBlocks.length - 1];
  if (lastBlock && lastBlock.type === type) {
    stream.streamingBlocks = [
      ...stream.streamingBlocks.slice(0, -1),
      {
        ...lastBlock,
        text: lastBlock.text + chunk,
      },
    ];
    return;
  }
  stream.streamingBlocks = [
    ...stream.streamingBlocks,
    {
      id: nextBlockId(stream, type),
      type,
      text: chunk,
    },
  ];
}

function ensureToolBlock(stream: ActiveStream, toolUseId: string): void {
  if (!toolUseId) {
    return;
  }
  const exists = stream.streamingBlocks.some(
    (block) => block.type === 'tool' && block.tool_use_id === toolUseId,
  );
  if (exists) {
    return;
  }
  stream.streamingBlocks = [
    ...stream.streamingBlocks,
    {
      id: nextBlockId(stream, 'tool'),
      type: 'tool',
      tool_use_id: toolUseId,
    },
  ];
}

/**
 * Atomically update snapshot fields. Always rebuilds from accumulators first,
 * then merges the provided overrides, so listeners never see a half-updated
 * snapshot where accumulators and metadata are out of sync.
 */
function updateSnapshotFields(
  stream: ActiveStream,
  overrides: Partial<SessionStreamSnapshot>,
): void {
  stream.snapshot = { ...buildSnapshot(stream), ...overrides };
}

function emit(stream: ActiveStream, type: StreamEvent['type']) {
  const current = getStreamsMap().get(stream.sessionId);
  // Ignore events from stale stream instances that have already been replaced
  // by a newer request for the same session.
  if (current && current !== stream) {
    return;
  }

  const snapshot = buildSnapshot(stream);
  stream.snapshot = snapshot; // store latest
  const event: StreamEvent = { type, sessionId: stream.sessionId, snapshot };

  // Notify session-specific listeners
  for (const listener of stream.listeners) {
    try { listener(event); } catch { /* listener error */ }
  }

  // Notify global listeners
  const globalListeners = getGlobalListeners();
  for (const listener of globalListeners) {
    try { listener(event); } catch { /* listener error */ }
  }
}

// Throttled emit for smooth text streaming (16ms ≈ 60fps).
// Uses a trailing-edge strategy: the last pending update within each window
// is always emitted, so no final frame is ever lost.
const THROTTLE_MS = 16;

function emitThrottled(stream: ActiveStream, type: StreamEvent['type'], immediate = false) {
  // Always record the latest event type so the trailing emit uses it
  stream.pendingEmitType = type;

  if (immediate) {
    // Flush immediately: clear any scheduled timer and emit now
    if (stream.throttleTimer) {
      clearTimeout(stream.throttleTimer);
      stream.throttleTimer = null;
    }
    stream.pendingEmit = false;
    stream.pendingEmitType = null;
    emit(stream, type);
    return;
  }

  // Mark that we have a pending update
  stream.pendingEmit = true;

  // If a timer is already scheduled, it will pick up the latest state when it fires
  if (stream.throttleTimer) {
    return;
  }

  // Schedule trailing-edge emit
  stream.throttleTimer = setTimeout(() => {
    stream.throttleTimer = null;
    if (stream.pendingEmit) {
      stream.pendingEmit = false;
      const emitType = stream.pendingEmitType ?? type;
      stream.pendingEmitType = null;
      emit(stream, emitType);
    }
  }, THROTTLE_MS);
}

function scheduleGC(stream: ActiveStream) {
  if (stream.gcTimer) clearTimeout(stream.gcTimer);
  stream.gcTimer = setTimeout(() => {
    const map = getStreamsMap();
    const current = map.get(stream.sessionId);
    if (current === stream && current.snapshot.phase !== 'active') {
      if (current.listeners.size > 0) {
        // Still has active subscribers (component mounted) — skip GC
        return;
      }
      map.delete(stream.sessionId);
    }
  }, GC_DELAY_MS);
}

function cleanupTimers(stream: ActiveStream) {
  if (stream.idleCheckTimer) {
    clearInterval(stream.idleCheckTimer);
    stream.idleCheckTimer = null;
  }
  if (stream.throttleTimer) {
    clearTimeout(stream.throttleTimer);
    stream.throttleTimer = null;
  }
}

function requestBackendStop(sessionId: string): void {
  void fetch('/api/chat/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
    keepalive: true,
  }).catch(() => {
    // best effort; local fallback snapshot still applies immediately
  });
}

function requestBackendStopOnce(stream: ActiveStream): void {
  if (stream.backendStopRequested) return;
  stream.backendStopRequested = true;
  requestBackendStop(stream.sessionId);
}

function upsertChildActivity(stream: ActiveStream, activity: ChildActivity): void {
  const index = stream.childActivitiesArray.findIndex((item) => item.id === activity.id);
  if (index < 0) {
    stream.childActivitiesArray = [...stream.childActivitiesArray, activity];
    return;
  }
  const next = [...stream.childActivitiesArray];
  next[index] = activity;
  stream.childActivitiesArray = next;
}

function finishChildActivities(
  stream: ActiveStream,
  status: 'completed' | 'failed' | 'stopped',
): void {
  const now = Date.now();
  stream.childActivitiesArray = stream.childActivitiesArray.map((activity) => (
    activity.status === 'running' || activity.status === 'waiting'
      ? { ...activity, status, updatedAt: now }
      : activity
  ));
}

// ==========================================
// Public API
// ==========================================

export function startStream(params: StartStreamParams): void {
  const map = getStreamsMap();
  const existing = map.get(params.sessionId);

  // If already streaming this session, abort old stream first
  if (existing && existing.snapshot.phase === 'active') {
    requestBackendStopOnce(existing);
    existing.abortController.abort();
    cleanupTimers(existing);
  }

  const abortController = new AbortController();

  const stream: ActiveStream = {
    sessionId: params.sessionId,
    abortController,
    snapshot: {
      sessionId: params.sessionId,
      clientMessageId: params.clientMessageId,
      phase: 'active',
      streamingContent: '',
      streamingReasoning: '',
      toolUses: [],
      toolResults: [],
      childActivities: [],
      streamingBlocks: [],
      streamingToolOutput: '',
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
      tokenUsage: null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      persistedUserMessageId: null,
      persistedUserCreatedAt: null,
      persistedMessageId: null,
      persistedRevision: null,
      persistedCreatedAt: null,
      finalMessageContent: null,
    },
    listeners: existing?.listeners ?? new Set(),
    idleCheckTimer: null,
    lastEventTime: Date.now(),
    gcTimer: null,
    accumulatedText: '',
    accumulatedReasoning: '',
    toolUsesArray: [],
    toolResultsArray: [],
    childActivitiesArray: [],
    streamingBlocks: [],
    blockSeq: 0,
    toolOutputAccumulated: '',
    toolTimeoutInfo: null,
    isIdleTimeout: false,
    backendStopRequested: false,
    throttleTimer: null,
    pendingEmit: false,
    pendingEmitType: null,
  };

  map.set(params.sessionId, stream);
  emit(stream, 'phase-changed');

  // Run the stream in background (non-blocking)
  runStream(stream, params).catch(() => {});
}

async function runStream(stream: ActiveStream, params: StartStreamParams): Promise<void> {
  const markActive = () => { stream.lastEventTime = Date.now(); };
  const isAcceptingEvents = () => stream.snapshot.phase === 'active';

  // Idle timeout checker
  stream.idleCheckTimer = setInterval(() => {
    if (Date.now() - stream.lastEventTime >= STREAM_IDLE_TIMEOUT_MS) {
      cleanupTimers(stream);
      stream.isIdleTimeout = true;
      requestBackendStopOnce(stream);
      stream.abortController.abort();
    }
  }, 10_000);

  // Flush pending image notices
  let effectiveContent = params.content;
  if (params.pendingImageNotices && params.pendingImageNotices.length > 0) {
    const notices = params.pendingImageNotices.join('\n\n');
    effectiveContent = `${notices}\n\n---\n\n${params.content}`;
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: params.sessionId,
        content: effectiveContent,
        ...(params.displayContent ? { display_content: params.displayContent } : {}),
        client_message_id: params.clientMessageId,
        mode: params.mode,
        model: params.model,
        provider_id: params.providerId,
        assistant_runtime: params.assistantRuntime,
        ...(params.files && params.files.length > 0 ? { files: params.files } : {}),
        ...(params.systemPromptAppend ? { systemPromptAppend: params.systemPromptAppend } : {}),
      }),
      signal: stream.abortController.signal,
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      let errorMessage = `Request failed (${response.status})`;
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody) as { error?: string; message?: string };
          errorMessage = parsed.error || parsed.message || errorMessage;
        } catch {
          const trimmed = rawBody.trim();
          if (trimmed) {
            errorMessage = trimmed.slice(0, 300);
          }
        }
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const result = await consumeSSEStream(reader, {
      onText: (acc) => {
        if (!isAcceptingEvents()) return;
        markActive();
        const previous = stream.accumulatedText;
        stream.accumulatedText = acc;
        const chunk = acc.startsWith(previous) ? acc.slice(previous.length) : acc;
        if (chunk) {
          appendTextLikeBlock(stream, 'text', chunk);
        }
        if (process.env.NODE_ENV === 'development') {
          console.log('[Stream] Text accumulated:', acc.length, 'chars');
        }
        emitThrottled(stream, 'snapshot-updated');
      },
      onReasoning: (acc) => {
        if (!isAcceptingEvents()) return;
        markActive();
        const previous = stream.accumulatedReasoning;
        stream.accumulatedReasoning = acc;
        const chunk = acc.startsWith(previous) ? acc.slice(previous.length) : acc;
        appendTextLikeBlock(stream, 'reasoning', chunk);
        emitThrottled(stream, 'snapshot-updated');
      },
      onToolUse: (tool) => {
        if (!isAcceptingEvents()) return;
        markActive();
        stream.toolOutputAccumulated = '';
        if (!stream.toolUsesArray.some(t => t.id === tool.id)) {
          stream.toolUsesArray = [...stream.toolUsesArray, tool];
        }
        ensureToolBlock(stream, tool.id);
        emit(stream, 'snapshot-updated');
      },
      onToolResult: (res) => {
        if (!isAcceptingEvents()) return;
        markActive();
        stream.toolOutputAccumulated = '';
        ensureToolBlock(stream, res.tool_use_id);
        const existingIdx = stream.toolResultsArray.findIndex(r => r.tool_use_id === res.tool_use_id);
        if (existingIdx >= 0) {
          const next = [...stream.toolResultsArray];
          next[existingIdx] = res;
          stream.toolResultsArray = next;
        } else {
          stream.toolResultsArray = [...stream.toolResultsArray, res];
        }
        emit(stream, 'snapshot-updated');
        // Refresh file tree after each tool completes
        publishRefreshFileTree();
      },
      onToolOutput: (data) => {
        if (!isAcceptingEvents()) return;
        markActive();
        const next = stream.toolOutputAccumulated + (stream.toolOutputAccumulated ? '\n' : '') + data;
        stream.toolOutputAccumulated = next.length > 5000 ? next.slice(-5000) : next;
        emitThrottled(stream, 'snapshot-updated');
      },
      onToolProgress: (toolName, elapsed) => {
        if (!isAcceptingEvents()) return;
        markActive();
        updateSnapshotFields(stream, { statusText: `Running ${toolName}... (${elapsed}s)` });
        emit(stream, 'snapshot-updated');
      },
      onStatus: (text) => {
        if (!isAcceptingEvents()) return;
        markActive();
        if (text?.startsWith('Connected (')) {
          updateSnapshotFields(stream, { statusText: text });
          emit(stream, 'snapshot-updated');
          const capturedText = text;
          setTimeout(() => {
            // Only clear if still the same status
            if (stream.snapshot.statusText === capturedText) {
              updateSnapshotFields(stream, { statusText: undefined });
              emit(stream, 'snapshot-updated');
            }
          }, 2000);
        } else {
          updateSnapshotFields(stream, { statusText: text });
          emit(stream, 'snapshot-updated');
        }
      },
      onResult: (usage) => {
        if (!isAcceptingEvents()) return;
        markActive();
        updateSnapshotFields(stream, { tokenUsage: usage });
      },
      onPermissionRequest: (permData) => {
        if (!isAcceptingEvents()) return;
        markActive();
        updateSnapshotFields(stream, {
          pendingPermission: permData,
          permissionResolved: null,
        });
        emitThrottled(stream, 'permission-request', true);
      },
      onToolTimeout: (toolName, elapsedSeconds) => {
        if (!isAcceptingEvents()) return;
        markActive();
        stream.toolTimeoutInfo = { toolName, elapsedSeconds };
      },
      onModeChanged: (sdkMode) => {
        if (!isAcceptingEvents()) return;
        markActive();
        if (params.onModeChanged) {
          params.onModeChanged(sdkMode);
        }
      },
      onTaskUpdate: () => {
        if (!isAcceptingEvents()) return;
        markActive();
        publishTasksUpdated();
      },
      onUserPersisted: (persisted) => {
        if (!isAcceptingEvents()) return;
        markActive();
        updateSnapshotFields(stream, {
          clientMessageId: persisted.client_message_id || stream.snapshot.clientMessageId,
          persistedUserMessageId: persisted.message_id,
          persistedUserCreatedAt: persisted.created_at,
        });
        emit(stream, 'snapshot-updated');
      },
      onAssistantPersisted: (persisted) => {
        if (!isAcceptingEvents()) return;
        markActive();
        updateSnapshotFields(stream, {
          clientMessageId: persisted.client_message_id || stream.snapshot.clientMessageId,
          persistedMessageId: persisted.message_id,
          persistedRevision: persisted.revision,
          persistedCreatedAt: persisted.created_at,
        });
        emit(stream, 'snapshot-updated');
      },
      onActivity: (activity) => {
        if (!isAcceptingEvents()) return;
        markActive();
        upsertChildActivity(stream, activity);
        emit(stream, 'snapshot-updated');
      },
      onHeartbeat: () => {
        if (!isAcceptingEvents()) return;
        markActive();
      },
      onError: (acc, detail) => {
        if (!isAcceptingEvents()) return;
        markActive();
        const previous = stream.accumulatedText;
        stream.accumulatedText = acc;
        const chunk = acc.startsWith(previous) ? acc.slice(previous.length) : acc;
        appendTextLikeBlock(stream, 'text', chunk);
        updateSnapshotFields(stream, {
          error: detail || MODEL_FAILURE_FALLBACK_MESSAGE,
        });
        emit(stream, 'snapshot-updated');
      },
    }, {
      sessionId: params.sessionId,
      source: 'sdk',
      allowLegacyFallback: false,
    });

    if (stream.snapshot.phase !== 'active') {
      cleanupTimers(stream);
      scheduleGC(stream);
      return;
    }

    const finalToolResults = buildTerminalToolResults(stream);
    stream.toolResultsArray = finalToolResults;

    const terminalError = stream.snapshot.error;
    finishChildActivities(stream, terminalError ? 'failed' : 'completed');

    // Update snapshot with completion info
    updateSnapshotFields(stream, {
      phase: terminalError ? 'error' : 'completed',
      completedAt: Date.now(),
      tokenUsage: result.tokenUsage,
      statusText: undefined,
      pendingPermission: null,
      permissionResolved: null,
    });

    cleanupTimers(stream);
    // Flush any pending throttled emit before completing
    emitThrottled(stream, 'completed', true);
    scheduleGC(stream);

    // Refresh file tree after completion
    publishRefreshFileTree();

  } catch (error) {
    cleanupTimers(stream);

    // Another control path may have already finalized this stream (e.g. stop
    // fallback during stuck permission wait). Avoid double terminal emissions.
    if (stream.snapshot.phase !== 'active') {
      scheduleGC(stream);
      return;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (stream.isIdleTimeout) {
        // Idle timeout
        const idleSecs = Math.round(STREAM_IDLE_TIMEOUT_MS / 1000);
        const errText = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n**Error:** Stream idle timeout — no response for ${idleSecs}s. The connection may have dropped.`
          : `**Error:** Stream idle timeout — no response for ${idleSecs}s. The connection may have dropped.`;
        stream.toolResultsArray = buildTerminalToolResults(stream, true);
        finishChildActivities(stream, 'failed');
        setTerminalTextContent(stream, errText);

        updateSnapshotFields(stream, {
          phase: 'error',
          completedAt: Date.now(),
          error: `Stream idle timeout (${idleSecs}s)`,
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        });
        emitThrottled(stream, 'completed', true);
        scheduleGC(stream);
      } else if (stream.toolTimeoutInfo) {
        // Ordinary tool timeout terminates this turn. It never creates a prompt.
        const timeoutInfo = stream.toolTimeoutInfo;
        const partialText = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + `\n\n*(tool ${timeoutInfo.toolName} timed out after ${timeoutInfo.elapsedSeconds}s)*`
          : `*(tool ${timeoutInfo.toolName} timed out after ${timeoutInfo.elapsedSeconds}s)*`;
        stream.toolResultsArray = buildTerminalToolResults(stream, true);
        finishChildActivities(stream, 'stopped');
        setTerminalTextContent(stream, partialText);

        updateSnapshotFields(stream, {
          phase: 'stopped',
          completedAt: Date.now(),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        });
        stream.toolTimeoutInfo = null;
        emit(stream, 'completed');
        scheduleGC(stream);

      } else {
        // User manually stopped — add partial content with "(generation stopped)"
        const partialText = stream.accumulatedText.trim()
          ? stream.accumulatedText.trim() + '\n\n*(generation stopped)*'
          : '*(generation stopped)*';
        stream.toolResultsArray = buildTerminalToolResults(stream);
        finishChildActivities(stream, 'stopped');
        setTerminalTextContent(stream, partialText);

        updateSnapshotFields(stream, {
          phase: 'stopped',
          completedAt: Date.now(),
          statusText: undefined,
          pendingPermission: null,
          permissionResolved: null,
        });
        emitThrottled(stream, 'completed', true);
        scheduleGC(stream);
      }
    } else {
      // Non-abort error
      requestBackendStopOnce(stream);
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorText = stream.accumulatedText.trim()
        ? `${stream.accumulatedText.trim()}\n\n${buildModelFailureText(errMsg)}`
        : buildModelFailureText(errMsg);
      stream.toolResultsArray = buildTerminalToolResults(stream, true);
      finishChildActivities(stream, 'failed');
      setTerminalTextContent(stream, errorText);
      updateSnapshotFields(stream, {
        phase: 'error',
        completedAt: Date.now(),
        error: errMsg,
        statusText: undefined,
        pendingPermission: null,
        permissionResolved: null,
      });
      emit(stream, 'completed');
      scheduleGC(stream);
    }
  }
}

// ==========================================
// Stop
// ==========================================

export function stopStream(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase === 'active') {
    // Explicitly stop the backend run and release session lock.
    // Relying only on client-side fetch abort is not enough in all environments.
    requestBackendStopOnce(stream);

    const stopFallbackSnapshot = () => {
      const partialText = stream.accumulatedText.trim()
        ? stream.accumulatedText.trim() + '\n\n*(generation stopped)*'
        : '*(generation stopped)*';
      stream.toolResultsArray = buildTerminalToolResults(stream);
      finishChildActivities(stream, 'stopped');
      setTerminalTextContent(stream, partialText);

      updateSnapshotFields(stream, {
        phase: 'stopped',
        completedAt: Date.now(),
        statusText: undefined,
        pendingPermission: null,
        permissionResolved: null,
      });
      emitThrottled(stream, 'completed', true);
      scheduleGC(stream);
    };

    stream.abortController.abort();
    cleanupTimers(stream);
    stopFallbackSnapshot();
  }
}

// ==========================================
// Subscribe
// ==========================================

// Global listeners that receive events from all sessions
const GLOBAL_LISTENERS_KEY = '__globalListeners__' as const;

function getGlobalListeners(): Set<StreamEventListener> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_LISTENERS_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_LISTENERS_KEY] = new Set<StreamEventListener>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_LISTENERS_KEY] as Set<StreamEventListener>;
}

export function subscribe(sessionId: string, listener: StreamEventListener): () => void {
  const stream = getOrCreateStream(sessionId);

  stream.listeners.add(listener);

  return () => {
    stream!.listeners.delete(listener);
  };
}

/**
 * Subscribe to events from all sessions globally.
 * Useful for keeping global state (like runtime-store) in sync
 * even when individual session components are unmounted.
 */
export function subscribeGlobal(listener: StreamEventListener): () => void {
  const globalListeners = getGlobalListeners();
  globalListeners.add(listener);

  return () => {
    globalListeners.delete(listener);
  };
}

// ==========================================
// Snapshot access
// ==========================================

export function getSnapshot(sessionId: string): SessionStreamSnapshot | null {
  const stream = getStreamsMap().get(sessionId);
  if (!stream) return null;
  // Don't return stale placeholder entries
  if (stream.snapshot.startedAt === 0) return null;
  return stream.snapshot;
}

export function isStreamActive(sessionId: string): boolean {
  const stream = getStreamsMap().get(sessionId);
  return stream?.snapshot.phase === 'active' || false;
}

export function getActiveSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, stream] of getStreamsMap()) {
    if (stream.snapshot.phase === 'active') {
      ids.push(id);
    }
  }
  return ids;
}

export async function recoverSessionSnapshot(sessionId: string): Promise<SessionStreamSnapshot | null> {
  return retryStrategy.executeWithRetry(
    async () => {
      let response: Response;
      try {
        response = await fetch(`/api/chat/sessions/${sessionId}`);
      } catch (error) {
        throw new RetryableError('Failed to fetch session recovery state', { cause: error });
      }

      if (!response.ok) {
        if (response.status >= 500) {
          throw new RetryableError(`Session recovery failed with status ${response.status}`);
        }
        return null;
      }

      const data = await response.json() as SessionRecoveryResponse;
      if (data.session.runtime_status !== 'waiting_permission' || !data.recovery?.pendingPermission) {
        return null;
      }

      const stream = getOrCreateStream(sessionId);
      resetStreamBuffers(stream);
      updateSnapshotFields(stream, {
        phase: 'active',
        statusText: data.recovery.requiresRestart
          ? 'Recovered permission request — resolving it will require restarting the interrupted run.'
          : `Waiting for authorization: ${data.recovery.pendingPermission.toolName}`,
        pendingPermission: data.recovery.pendingPermission,
        startedAt: parseRuntimeUpdatedAt(data.session.runtime_updated_at),
        error: data.recovery.runtimeError || null,
      });
      emit(stream, 'snapshot-updated');
      return stream.snapshot;
    },
    {
      maxRetries: 2,
      backoff: 'exponential',
      baseDelayMs: 250,
      shouldRetry: (error) => error instanceof RetryableError,
    },
  );
}

// ==========================================
// Permission response
// ==========================================

export async function respondToPermission(
  sessionId: string,
  decision: 'allow' | 'allow_session' | 'deny',
  updatedInput?: Record<string, unknown>,
): Promise<void> {
  const stream = getStreamsMap().get(sessionId);
  if (!stream || !stream.snapshot.pendingPermission) return;

  const perm = stream.snapshot.pendingPermission;

  const body = {
    permissionRequestId: perm.permissionRequestId,
    decision: decision === 'deny'
      ? { behavior: 'deny' as const, message: 'User denied permission' }
      : {
          behavior: 'allow' as const,
          ...(decision === 'allow_session' && perm.suggestions
            ? { updatedPermissions: perm.suggestions }
            : {}),
          ...(updatedInput ? { updatedInput } : {}),
        },
  };

  // Update snapshot immediately
  updateSnapshotFields(stream, {
    permissionResolved: decision === 'deny' ? 'deny' : 'allow',
  });
  emit(stream, 'snapshot-updated');

  let shouldClearPermission = true;

  try {
    const result = await retryStrategy.executeWithRetry(
      async () => {
        let response: Response;
        try {
          response = await fetch('/api/chat/permission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch (error) {
          throw new RetryableError('Failed to submit permission response', { cause: error });
        }

        const payload = await response.json().catch(() => ({})) as { code?: string; requires_restart?: boolean };
        if (!response.ok) {
          if (response.status === 409 && payload.code === 'ALREADY_RESOLVED') {
            return { requires_restart: false };
          }
          if (response.status >= 500) {
            throw new RetryableError('Permission response failed on the server');
          }
          throw new Error('Failed to resolve permission request');
        }

        return payload;
      },
      {
        maxRetries: 2,
        backoff: 'linear',
        baseDelayMs: 250,
        shouldRetry: (error) => error instanceof RetryableError,
      },
    );

    if (result.requires_restart) {
      const partialText = stream.accumulatedText.trim()
        ? stream.accumulatedText.trim() + '\n\n*(generation stopped)*'
        : '*(generation stopped)*';
      stream.toolResultsArray = buildTerminalToolResults(stream, decision === 'deny');
      setTerminalTextContent(stream, partialText);

      updateSnapshotFields(stream, {
        phase: 'stopped',
        completedAt: Date.now(),
        statusText: undefined,
        pendingPermission: null,
        permissionResolved: null,
      });
      emitThrottled(stream, 'completed', true);
      scheduleGC(stream);
      return;
    }
  } catch {
    shouldClearPermission = false;
    updateSnapshotFields(stream, {
      permissionResolved: null,
      statusText: 'Failed to sync permission decision. Please retry.',
    });
    emit(stream, 'snapshot-updated');
  }

  if (!shouldClearPermission) {
    return;
  }

  const answeredId = perm.permissionRequestId;
  setTimeout(() => {
    if (stream.snapshot.pendingPermission?.permissionRequestId === answeredId) {
      updateSnapshotFields(stream, {
        pendingPermission: null,
        permissionResolved: null,
      });
      emit(stream, 'snapshot-updated');
    }
  }, 1000);
}

// ==========================================
// Cleanup
// ==========================================

export function clearSnapshot(sessionId: string): void {
  const stream = getStreamsMap().get(sessionId);
  if (stream && stream.snapshot.phase !== 'active') {
    if (stream.gcTimer) clearTimeout(stream.gcTimer);
    resetStreamBuffers(stream);
    // Keep the listeners entry but release terminal payload after the UI
    // has finalized it into the shared message store.
    stream.snapshot = createEmptySnapshot(sessionId);
  }
}
