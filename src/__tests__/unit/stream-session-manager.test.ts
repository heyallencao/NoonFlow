import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildSnapshotAssistantContent } from '../../lib/chat-streaming-message';
import type { SSEEvent, StreamEvent, StreamingMessageBlock } from '../../types';

let importVersion = 0;
const originalFetch = global.fetch;
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;
const originalDateNow = Date.now;

async function importFreshStreamSessionManager() {
  const moduleUrl = pathToFileURL(path.resolve('src/lib/stream-session-manager.ts'));
  moduleUrl.searchParams.set('v', String(importVersion += 1));
  const imported = await import(moduleUrl.href);
  return ((imported as { default?: unknown }).default ?? imported) as typeof import('../../lib/stream-session-manager');
}

function createSSEBody(events: SSEEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });
}

async function settleStreamAndClear(
  sessionId: string,
  clearSnapshot: (sessionId: string) => void,
): Promise<void> {
  // stream-session-manager may schedule terminal GC in a later microtask/branch
  // (for example after an abort race). Clear twice across ticks to avoid timer leaks in tests.
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearSnapshot(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearSnapshot(sessionId);
}

afterEach(() => {
  global.fetch = originalFetch;
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
  Date.now = originalDateNow;
});

describe('stream-session-manager terminal snapshots', () => {
  it('keeps the final streamed frame in snapshot buffers after completion', async () => {
    const {
      startStream,
      subscribe,
      getSnapshot,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    global.fetch = async () => new Response(createSSEBody([
      { type: 'text', data: 'final reply' },
      { type: 'result', data: JSON.stringify({ usage: { input_tokens: 1, output_tokens: 2 } }) },
      { type: 'done', data: '' },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const sessionId = `stream-manager-test-${Date.now()}`;
    const completedSnapshotPromise = new Promise<Awaited<ReturnType<typeof getSnapshot>>>((resolve) => {
      const unsubscribe = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type !== 'completed') {
          return;
        }
        unsubscribe();
        resolve(event.snapshot);
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-test-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    const snapshot = await completedSnapshotPromise;
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'completed');
    assert.equal(snapshot.finalMessageContent, null);
    assert.equal(snapshot.streamingContent, 'final reply');
    assert.equal(snapshot.tokenUsage?.input_tokens, 1);
    assert.equal(snapshot.tokenUsage?.output_tokens, 2);
    assert.equal(
      snapshot.streamingBlocks.some((block: StreamingMessageBlock) => block.type === 'text' && block.text === 'final reply'),
      true,
    );
    assert.equal(buildSnapshotAssistantContent(snapshot), 'final reply');

    assert.equal(getSnapshot(sessionId)?.streamingContent, 'final reply');
    await settleStreamAndClear(sessionId, clearSnapshot);
    assert.equal(getSnapshot(sessionId), null);
  });

  it('preserves partial content when manually stopped', async () => {
    const {
      startStream,
      subscribe,
      stopStream,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const encoder = new TextEncoder();
    let stopCallCount = 0;

    // Stream that sends one chunk then waits — abort signal will close it
    global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
      if (requestUrl === '/api/chat/stop') {
        stopCallCount += 1;
        return new Response(JSON.stringify({ stopped: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: 'partial content' })}\n`));
          // Close when aborted so the test doesn't hang
          if (signal) {
            signal.addEventListener('abort', () => {
              try { controller.close(); } catch { /* already closed */ }
            });
          }
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };

    const sessionId = `stop-test-${Date.now()}`;

    // Wait for the first snapshot update so we know the stream is active
    const activePromise = new Promise<void>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'snapshot-updated' && event.snapshot.streamingContent) {
          unsub();
          resolve();
        }
      });
    });

    // Capture the completed event from stopStream
    const stoppedPromise = new Promise<Awaited<ReturnType<typeof import('../../lib/stream-session-manager').getSnapshot>>>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed' && event.snapshot.phase === 'stopped') {
          unsub();
          resolve(event.snapshot);
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-stop-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    await activePromise;
    stopStream(sessionId);
    stopStream(sessionId);

    const snapshot = await stoppedPromise;
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'stopped');
    assert.equal(snapshot.finalMessageContent, null);
    assert.ok(snapshot.streamingContent.includes('partial content'));
    assert.ok(snapshot.streamingContent.includes('*(generation stopped)*'));
    assert.ok(snapshot.streamingBlocks.length > 0);
    assert.ok(buildSnapshotAssistantContent(snapshot).includes('partial content'));
    assert.equal(stopCallCount, 1);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('preserves content on stream error', async () => {
    const {
      startStream,
      subscribe,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    global.fetch = async () => new Response(createSSEBody([
      { type: 'text', data: 'before error' },
      { type: 'error', data: 'server exploded' },
      { type: 'done', data: '' },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const sessionId = `error-test-${Date.now()}`;
    const completedPromise = new Promise<Awaited<ReturnType<typeof import('../../lib/stream-session-manager').getSnapshot>>>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed') {
          unsub();
          resolve(event.snapshot);
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-error-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    const snapshot = await completedPromise;
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'error');
    assert.equal(snapshot.error, 'server exploded');
    assert.equal(snapshot.finalMessageContent, null);
    assert.ok(snapshot.streamingContent.includes('before error'));
    assert.ok(snapshot.streamingBlocks.length > 0);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('requests backend stop when the stream hits idle timeout', async () => {
    const {
      startStream,
      subscribe,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    let fakeNow = 1_000_000;
    let idleTimerCallback: (() => void) | null = null;
    let stopCalled = false;

    Date.now = () => fakeNow;
    global.setInterval = (((handler: TimerHandler) => {
      idleTimerCallback = () => {
        if (typeof handler === 'function') {
          handler();
        }
      };
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown) as typeof global.setInterval;
    global.clearInterval = (() => undefined) as typeof global.clearInterval;

    global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;

      if (requestUrl === '/api/chat/stop') {
        stopCalled = true;
        return new Response(JSON.stringify({ stopped: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }

        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }

        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    };

    const sessionId = `idle-timeout-test-${Date.now()}`;
    const completedPromise = new Promise<Awaited<ReturnType<typeof import('../../lib/stream-session-manager').getSnapshot>>>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed') {
          unsub();
          resolve(event.snapshot);
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-idle-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    if (!idleTimerCallback) {
      throw new Error('idle timer callback was not registered');
    }
    const triggerIdleTimer: () => void = idleTimerCallback;

    fakeNow += 331_000;
    triggerIdleTimer();

    const snapshot = await completedPromise;
    assert.ok(snapshot);
    assert.equal(stopCalled, true);
    assert.equal(snapshot.phase, 'error');
    assert.equal(snapshot.error, 'Stream idle timeout (330s)');
    assert.match(snapshot.streamingContent, /idle timeout/i);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('keeps a long silent child activity alive from activity and heartbeat events, then stops once on a real idle gap', async () => {
    const {
      startStream,
      subscribe,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const encoder = new TextEncoder();
    let fakeNow = 2_000_000;
    let idleTimerCallback: (() => void) | null = null;
    let responseController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let stopCallCount = 0;

    Date.now = () => fakeNow;
    global.setInterval = (((handler: TimerHandler) => {
      idleTimerCallback = () => {
        if (typeof handler === 'function') handler();
      };
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown) as typeof global.setInterval;
    global.clearInterval = (() => undefined) as typeof global.clearInterval;

    global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (requestUrl === '/api/chat/stop') {
        stopCallCount += 1;
        return new Response(JSON.stringify({ stopped: true }), { status: 200 });
      }

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          responseController = controller;
          init?.signal?.addEventListener('abort', () => {
            try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* terminal */ }
          }, { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const sessionId = `activity-heartbeat-${Date.now()}`;
    const activitySeen = new Promise<void>((resolve) => {
      const unsubscribe = subscribe(sessionId, (event: StreamEvent) => {
        if (event.snapshot.childActivities.some((activity) => activity.id === 'child-1')) {
          unsubscribe();
          resolve();
        }
      });
    });
    const completed = new Promise<Awaited<ReturnType<typeof import('../../lib/stream-session-manager').getSnapshot>>>((resolve) => {
      const unsubscribe = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed') {
          unsubscribe();
          resolve(event.snapshot);
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-activity-1',
      content: 'run child',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!responseController || !idleTimerCallback) throw new Error('stream timers were not registered');
    const activeResponseController = responseController as unknown as ReadableStreamDefaultController<Uint8Array>;
    const triggerIdleTimer = idleTimerCallback as unknown as () => void;
    fakeNow += 320_000;
    activeResponseController.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: 'activity.updated',
      data: JSON.stringify({
        id: 'child-1',
        runtime: 'claude_code',
        kind: 'subagent',
        title: 'Long review',
        status: 'running',
        startedAt: fakeNow - 320_000,
        updatedAt: fakeNow,
      }),
    })}\n\n`));
    await activitySeen;

    fakeNow += 320_000;
    activeResponseController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'runtime.heartbeat', data: '' })}\n\n`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    triggerIdleTimer();
    assert.equal(stopCallCount, 0);

    fakeNow += 331_000;
    triggerIdleTimer();
    const snapshot = await completed;
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'error');
    assert.equal(stopCallCount, 1);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('snapshot survives getSnapshot after completion (recovery scenario)', async () => {
    const {
      startStream,
      subscribe,
      getSnapshot,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    global.fetch = async () => new Response(createSSEBody([
      { type: 'text', data: 'recoverable content' },
      { type: 'result', data: JSON.stringify({ usage: { input_tokens: 5, output_tokens: 10 } }) },
      { type: 'done', data: '' },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const sessionId = `recovery-test-${Date.now()}`;
    const completedPromise = new Promise<void>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed') {
          unsub();
          resolve();
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-recovery-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    await completedPromise;

    // Simulate a "page refresh recovery" — getSnapshot should still return the terminal snapshot
    const recovered = getSnapshot(sessionId);
    assert.ok(recovered);
    assert.equal(recovered.phase, 'completed');
    assert.equal(recovered.clientMessageId, 'msg-recovery-1');
    assert.equal(recovered.streamingContent, 'recoverable content');
    assert.equal(recovered.finalMessageContent, null);
    assert.ok(recovered.streamingBlocks.some(
      (b: StreamingMessageBlock) => b.type === 'text' && b.text === 'recoverable content',
    ));
    assert.equal(buildSnapshotAssistantContent(recovered), 'recoverable content');

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('keeps persisted ack metadata when persisted events arrive after done before stream close', async () => {
    const {
      startStream,
      subscribe,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const sessionId = `persisted-after-done-${Date.now()}`;
    global.fetch = async () => new Response(createSSEBody([
      {
        type: 'user_persisted',
        data: JSON.stringify({
          session_id: sessionId,
          client_message_id: 'msg-persisted-1',
          message_id: 'msg-user-1',
          created_at: '2026-03-21 12:00:00',
        }),
      },
      { type: 'text', data: 'final reply' },
      { type: 'done', data: '' },
      {
        type: 'persisted',
        data: JSON.stringify({
          session_id: sessionId,
          client_message_id: 'msg-persisted-1',
          message_id: 'msg-assistant-1',
          revision: 3,
          created_at: '2026-03-21 12:00:01',
        }),
      },
      { type: 'result', data: JSON.stringify({ usage: { input_tokens: 2, output_tokens: 5 } }) },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const completedSnapshotPromise = new Promise<Awaited<ReturnType<typeof import('../../lib/stream-session-manager').getSnapshot>>>((resolve) => {
      const unsubscribe = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type !== 'completed') {
          return;
        }
        unsubscribe();
        resolve(event.snapshot);
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-persisted-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
    });

    const snapshot = await completedSnapshotPromise;
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'completed');
    assert.equal(snapshot.streamingContent, 'final reply');
    assert.equal(snapshot.clientMessageId, 'msg-persisted-1');
    assert.equal(snapshot.persistedUserMessageId, 'msg-user-1');
    assert.equal(snapshot.persistedUserCreatedAt, '2026-03-21 12:00:00');
    assert.equal(snapshot.persistedMessageId, 'msg-assistant-1');
    assert.equal(snapshot.persistedRevision, 3);
    assert.equal(snapshot.persistedCreatedAt, '2026-03-21 12:00:01');
    assert.equal(snapshot.tokenUsage?.input_tokens, 2);
    assert.equal(snapshot.tokenUsage?.output_tokens, 5);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('recovers waiting permission snapshot from session recovery endpoint', async () => {
    const {
      recoverSessionSnapshot,
      stopStream,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const sessionId = `recover-permission-${Date.now()}`;
    global.fetch = async (input: string | URL | Request) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (requestUrl.endsWith(`/api/chat/sessions/${sessionId}`)) {
        return new Response(JSON.stringify({
          session: {
            runtime_status: 'waiting_permission',
            runtime_updated_at: '2026-03-21 13:00:00',
          },
          recovery: {
            requiresRestart: true,
            runtimeError: 'stream interrupted while awaiting approval',
            pendingPermission: {
              permissionRequestId: 'perm-recover-1',
              toolName: 'exec_command',
              toolInput: { cmd: 'ls' },
              toolUseId: 'tool-recover-1',
              suggestions: [],
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };

    const snapshot = await recoverSessionSnapshot(sessionId);
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'active');
    assert.equal(snapshot.pendingPermission?.permissionRequestId, 'perm-recover-1');
    assert.equal(snapshot.pendingPermission?.toolName, 'exec_command');
    assert.equal(snapshot.error, 'stream interrupted while awaiting approval');
    assert.match(snapshot.statusText || '', /Recovered permission request/i);
    assert.ok(snapshot.startedAt > 0);

    stopStream(sessionId);
    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('stops the recovered run when permission response requires restart', async () => {
    const {
      recoverSessionSnapshot,
      respondToPermission,
      subscribe,
      getSnapshot,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const sessionId = `permission-restart-${Date.now()}`;
    global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (requestUrl.endsWith(`/api/chat/sessions/${sessionId}`) && method === 'GET') {
        return new Response(JSON.stringify({
          session: {
            runtime_status: 'waiting_permission',
            runtime_updated_at: '2026-03-21 13:10:00',
          },
          recovery: {
            requiresRestart: true,
            runtimeError: '',
            pendingPermission: {
              permissionRequestId: 'perm-restart-1',
              toolName: 'exec_command',
              toolInput: { cmd: 'pwd' },
              toolUseId: 'tool-restart-1',
              suggestions: [],
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (requestUrl.endsWith('/api/chat/permission') && method === 'POST') {
        return new Response(JSON.stringify({ requires_restart: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    };

    await recoverSessionSnapshot(sessionId);

    const stoppedPromise = new Promise<void>((resolve) => {
      const unsubscribe = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed' && event.snapshot.phase === 'stopped') {
          unsubscribe();
          resolve();
        }
      });
    });

    await respondToPermission(sessionId, 'allow');
    await stoppedPromise;

    const snapshot = getSnapshot(sessionId);
    assert.ok(snapshot);
    assert.equal(snapshot.phase, 'stopped');
    assert.equal(snapshot.pendingPermission, null);
    assert.equal(snapshot.permissionResolved, null);
    assert.ok(snapshot.streamingContent.includes('*(generation stopped)*'));

    await settleStreamAndClear(sessionId, clearSnapshot);
  });

  it('tool timeout stops the turn without automatically sending another prompt', async () => {
    const {
      startStream,
      subscribe,
      clearSnapshot,
    } = await importFreshStreamSessionManager();

    const encoder = new TextEncoder();
    const retries: Array<{ content: string; clientMessageId?: string }> = [];

    global.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'tool_timeout',
          data: JSON.stringify({ tool_name: 'Read', elapsed_seconds: 45 }),
        })}\n\n`));
        setTimeout(() => {
          controller.error(new DOMException('Tool timeout abort', 'AbortError'));
        }, 0);
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const sessionId = `tool-timeout-test-${Date.now()}`;
    const completedPromise = new Promise<void>((resolve) => {
      const unsub = subscribe(sessionId, (event: StreamEvent) => {
        if (event.type === 'completed' && event.snapshot.phase === 'stopped') {
          unsub();
          resolve();
        }
      });
    });

    startStream({
      sessionId,
      clientMessageId: 'msg-timeout-1',
      content: 'hello',
      mode: 'code',
      model: 'test-model',
      providerId: '',
      assistantRuntime: 'claude_code',
      sendMessageFn: (content, _files, clientMessageId) => {
        retries.push({ content, clientMessageId });
      },
    });

    await completedPromise;
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(retries.length, 0);

    await settleStreamAndClear(sessionId, clearSnapshot);
  });
});
