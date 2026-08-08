import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-agent-runtime-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
// Pre-create an empty DB file so db-core does not auto-migrate from the
// developer's legacy userData database during unit tests.
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'a'));

let consumeSSEStream: typeof import('../../hooks/useSSEStream').consumeSSEStream;
let EventBus: typeof import('../../lib/agent-runtime/event-bus').EventBus;
let SDKAdapter: typeof import('../../lib/agent-runtime/sdk-adapter').SDKAdapter;
let Orchestrator: typeof import('../../lib/agent-runtime/orchestrator').Orchestrator;
let addMessage: typeof import('../../lib/db').addMessage;
let closeDb: typeof import('../../lib/db').closeDb;
let createSession: typeof import('../../lib/db').createSession;
let getMessageParts: typeof import('../../lib/db').getMessageParts;
let getSession: typeof import('../../lib/db').getSession;
let getSessionRuntimeState: typeof import('../../lib/db').getSessionRuntimeState;
let replaceMessageParts: typeof import('../../lib/db').replaceMessageParts;

function createSSEReader(events: Array<{ type: string; data: string }>): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`));
      }
      controller.close();
    },
  });

  return stream.getReader();
}

before(async () => {
  ({ consumeSSEStream } = await import('../../hooks/useSSEStream'));
  ({ EventBus } = await import('../../lib/agent-runtime/event-bus'));
  ({ SDKAdapter } = await import('../../lib/agent-runtime/sdk-adapter'));
  ({ Orchestrator } = await import('../../lib/agent-runtime/orchestrator'));
  ({
    addMessage,
    closeDb,
    createSession,
    getMessageParts,
    getSession,
    getSessionRuntimeState,
    replaceMessageParts,
  } = await import('../../lib/db'));
});

afterEach(() => {
  delete process.env.MONOLITH_CHAT_ROLLOUT_MODE;
  delete process.env.NEXT_PUBLIC_MONOLITH_CHAT_ROLLOUT_MODE;
});

describe('EventBus', () => {
  it('emits typed and wildcard subscribers and supports unsubscribe', () => {
    const bus = new EventBus();
    const received: string[] = [];

    const offTyped = bus.on('session.started', (event) => {
      received.push(`typed:${event.type}`);
    });
    const offWildcard = bus.on('*', (event) => {
      received.push(`all:${event.type}`);
    });

    bus.emit({
      type: 'session.started',
      metadata: {
        sessionId: 'session-1',
        timestamp: 1,
        source: 'sdk',
        rawType: 'status',
        eventId: 'session-1:status:1',
      },
      model: 'sonnet',
      sdkSessionId: 'sdk-1',
      tools: ['Read'],
    });

    assert.deepEqual(received, ['typed:session.started', 'all:session.started']);

    offTyped();
    received.length = 0;

    bus.emit({
      type: 'session.started',
      metadata: {
        sessionId: 'session-1',
        timestamp: 2,
        source: 'sdk',
        rawType: 'status',
        eventId: 'session-1:status:2',
      },
      model: 'sonnet',
    });

    assert.deepEqual(received, ['all:session.started']);
    offWildcard();
  });
});

describe('SDKAdapter', () => {
  const context = {
    sessionId: 'session-1',
    source: 'sdk' as const,
    timestamp: 1700000000000,
  };

  it('adapts SSE stream events into typed runtime events', () => {
    const adapter = new SDKAdapter();
    const textEvent = adapter.adaptSSEEvent({ type: 'text', data: 'hello' }, context);
    assert.equal(textEvent?.type, 'message.delta');
    assert.equal(textEvent?.content, 'hello');

    const toolStart = adapter.adaptSSEEvent({
      type: 'tool_use',
      data: JSON.stringify({ id: 'tool-1', name: 'Read', input: { file_path: '/tmp/demo.ts' } }),
    }, context);
    assert.equal(toolStart?.type, 'tool.start');
    assert.equal(toolStart?.toolUseId, 'tool-1');
    assert.equal(toolStart?.toolName, 'Read');

    const toolProgress = adapter.adaptSSEEvent({
      type: 'tool_output',
      data: JSON.stringify({ _progress: true, tool_name: 'Read', elapsed_time_seconds: 3.2 }),
    }, context);
    assert.equal(toolProgress?.type, 'tool.progress');
    assert.equal(toolProgress?.toolName, 'Read');
    assert.equal(toolProgress?.elapsedSeconds, 3);

    const reasoningEvent = adapter.adaptSSEEvent({
      type: 'reasoning',
      data: 'thinking',
    }, context);
    assert.equal(reasoningEvent?.type, 'message.reasoning');
    assert.equal(reasoningEvent?.content, 'thinking');

    const toolTimeoutEvent = adapter.adaptSSEEvent({
      type: 'tool_timeout',
      data: JSON.stringify({ tool_name: 'Read', elapsed_seconds: 7.2 }),
    }, context);
    assert.equal(toolTimeoutEvent?.type, 'tool.timeout');
    assert.equal(toolTimeoutEvent?.toolName, 'Read');
    assert.equal(toolTimeoutEvent?.elapsedSeconds, 7);

    const startedEvent = adapter.adaptSSEEvent({
      type: 'status',
      data: JSON.stringify({ session_id: 'sdk-1', model: 'sonnet', tools: ['Read', 'Edit'] }),
    }, context);
    assert.equal(startedEvent?.type, 'session.started');
    assert.equal(startedEvent?.sdkSessionId, 'sdk-1');

    const resultEvent = adapter.adaptSSEEvent({
      type: 'result',
      data: JSON.stringify({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 1,
          cache_creation_input_tokens: 2,
          cost_usd: '0.42',
        },
        is_error: false,
        session_id: 'sdk-1',
        duration_ms: 1234,
      }),
    }, context);
    assert.equal(resultEvent?.type, 'session.result');
    assert.equal(resultEvent?.usage?.cost_usd, 0.42);
    assert.equal(resultEvent?.durationMs, 1234);

    const permissionEvent = adapter.adaptSSEEvent({
      type: 'permission_request',
      data: JSON.stringify({
        permissionRequestId: 'perm-1',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/demo.ts' },
        toolUseId: 'tool-1',
        description: 'Read demo file',
      }),
    }, context);
    assert.equal(permissionEvent?.type, 'permission.required');
    assert.equal(permissionEvent?.request.permissionRequestId, 'perm-1');

    const persistedEvent = adapter.adaptSSEEvent({
      type: 'persisted',
      data: JSON.stringify({
        session_id: 'session-1',
        client_message_id: 'msg-123',
        message_id: 'db-msg-1',
        revision: 2,
        created_at: '2026-03-20 10:00:00',
      }),
    }, context);
    assert.equal(persistedEvent?.type, 'message.assistant.persisted');
    assert.equal(persistedEvent?.clientMessageId, 'msg-123');
    assert.equal(persistedEvent?.messageId, 'db-msg-1');

    const userPersistedEvent = adapter.adaptSSEEvent({
      type: 'user_persisted',
      data: JSON.stringify({
        session_id: 'session-1',
        client_message_id: 'msg-123',
        message_id: 'db-user-1',
        created_at: '2026-03-20 09:59:59',
      }),
    }, context);
    assert.equal(userPersistedEvent?.type, 'message.user.persisted');
    assert.equal(userPersistedEvent?.clientMessageId, 'msg-123');
    assert.equal(userPersistedEvent?.messageId, 'db-user-1');
  });

  it('adapts SDK-native events into the same runtime protocol', () => {
    const adapter = new SDKAdapter();
    const initEvent = adapter.adaptSDKEvent({
      type: 'system',
      subtype: 'init',
      session_id: 'sdk-2',
      model: 'sonnet',
      tools: ['Read'],
    }, context);
    assert.equal(initEvent?.type, 'session.started');
    assert.equal(initEvent?.sdkSessionId, 'sdk-2');

    const assistantEvent = adapter.adaptSDKEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'assistant delta' }],
      },
    }, context);
    assert.equal(assistantEvent?.type, 'message.delta');
    assert.equal(assistantEvent?.content, 'assistant delta');

    const toolResultEvent = adapter.adaptSDKEvent({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'ok', is_error: false }],
      },
    }, context);
    assert.equal(toolResultEvent?.type, 'tool.result');
    assert.equal(toolResultEvent?.toolUseId, 'tool-2');
    assert.equal(toolResultEvent?.success, true);

    const assistantReasoningEvent = adapter.adaptSDKEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'reasoning', text: 'thinking block' }],
      },
    }, context);
    assert.equal(assistantReasoningEvent?.type, 'message.reasoning');
    assert.equal(assistantReasoningEvent?.content, 'thinking block');
  });

  it('routes reasoning and tool timeout through the typed stream consumer path', async () => {
    let reasoning = '';
    let timeout: { toolName: string; elapsedSeconds: number } | null = null;

    await consumeSSEStream(
      createSSEReader([
        { type: 'reasoning', data: 'step 1' },
        { type: 'tool_timeout', data: JSON.stringify({ tool_name: 'Read', elapsed_seconds: 9.4 }) },
        { type: 'done', data: '' },
      ]),
      {
        onText: () => {},
        onReasoning: (accumulated) => {
          reasoning = accumulated;
        },
        onToolUse: () => {},
        onToolResult: () => {},
        onToolOutput: () => {},
        onToolProgress: () => {},
        onStatus: () => {},
        onResult: () => {},
        onPermissionRequest: () => {},
        onToolTimeout: (toolName, elapsedSeconds) => {
          timeout = { toolName, elapsedSeconds };
        },
        onModeChanged: () => {},
        onTaskUpdate: () => {},
        onUserPersisted: () => {},
        onAssistantPersisted: () => {},
        onError: () => {},
      },
      {
        sessionId: 'session-typed-stream',
        source: 'sdk',
        emitToEventBus: false,
      },
    );

    assert.equal(reasoning, 'step 1');
    assert.deepEqual(timeout, { toolName: 'Read', elapsedSeconds: 9 });
  });

  it('keeps consuming persisted ack events that arrive after done', async () => {
    const users: Array<{ clientMessageId: string; messageId: string }> = [];
    const persisted: Array<{ clientMessageId: string; messageId: string; revision: number }> = [];

    await consumeSSEStream(
      createSSEReader([
        {
          type: 'user_persisted',
          data: JSON.stringify({
            session_id: 'session-typed-stream',
            client_message_id: 'msg-123',
            message_id: 'db-user-1',
            created_at: '2026-03-20 09:59:59',
          }),
        },
        { type: 'text', data: 'hello' },
        { type: 'done', data: '' },
        {
          type: 'persisted',
          data: JSON.stringify({
            session_id: 'session-typed-stream',
            client_message_id: 'msg-123',
            message_id: 'db-msg-1',
            revision: 3,
            created_at: '2026-03-20 10:00:00',
          }),
        },
      ]),
      {
        onText: () => {},
        onReasoning: () => {},
        onToolUse: () => {},
        onToolResult: () => {},
        onToolOutput: () => {},
        onToolProgress: () => {},
        onStatus: () => {},
        onResult: () => {},
        onPermissionRequest: () => {},
        onToolTimeout: () => {},
        onModeChanged: () => {},
        onTaskUpdate: () => {},
        onUserPersisted: (data) => {
          users.push({
            clientMessageId: data.client_message_id,
            messageId: data.message_id,
          });
        },
        onAssistantPersisted: (data) => {
          persisted.push({
            clientMessageId: data.client_message_id,
            messageId: data.message_id,
            revision: data.revision,
          });
        },
        onError: () => {},
      },
      {
        sessionId: 'session-typed-stream',
        source: 'sdk',
        emitToEventBus: false,
      },
    );

    assert.deepEqual(users, [
      { clientMessageId: 'msg-123', messageId: 'db-user-1' },
    ]);
    assert.deepEqual(persisted, [
      { clientMessageId: 'msg-123', messageId: 'db-msg-1', revision: 3 },
    ]);
  });

  it('defaults to strict typed mode and only runs legacy fallback for explicit legacy rollout mode', async () => {
    let strictText = '';
    let bridgeFallbackText = '';
    let legacyFallbackText = '';

    const createCallbacks = (onText: (value: string) => void) => ({
      onText,
      onReasoning: () => {},
      onToolUse: () => {},
      onToolResult: () => {},
      onToolOutput: () => {},
      onToolProgress: () => {},
      onStatus: () => {},
      onResult: () => {},
      onPermissionRequest: () => {},
      onToolTimeout: () => {},
      onModeChanged: () => {},
      onTaskUpdate: () => {},
      onUserPersisted: () => {},
      onAssistantPersisted: () => {},
      onError: () => {},
    });

    await consumeSSEStream(
      createSSEReader([
        { type: 'text', data: 'legacy-only' },
      ]),
      createCallbacks((value) => {
        strictText = value;
      }),
      {
        emitToEventBus: false,
      },
    );

    await consumeSSEStream(
      createSSEReader([
        { type: 'text', data: 'legacy-only' },
      ]),
      createCallbacks((value) => {
        bridgeFallbackText = value;
      }),
      {
        emitToEventBus: false,
        allowLegacyFallback: true,
      },
    );

    process.env.MONOLITH_CHAT_ROLLOUT_MODE = 'legacy';
    await consumeSSEStream(
      createSSEReader([
        { type: 'text', data: 'legacy-only' },
      ]),
      createCallbacks((value) => {
        legacyFallbackText = value;
      }),
      {
        emitToEventBus: false,
        allowLegacyFallback: true,
      },
    );

    assert.equal(strictText, '');
    assert.equal(bridgeFallbackText, '');
    assert.equal(legacyFallbackText, 'legacy-only');
  });
});

describe('Orchestrator', () => {
  afterEach(() => {
    closeDb();
  });

  it('persists runtime lifecycle and permission transitions', async () => {
    const session = createSession('Agent Runtime', 'sonnet', '', tmpDir);
    const bus = new EventBus();
    const orchestrator = new Orchestrator(bus);
    const emittedTypes: string[] = [];

    bus.on('*', (event) => {
      emittedTypes.push(event.type);
    });

    await orchestrator.startSession({
      sessionId: session.id,
      source: 'sdk',
      workingDirectory: tmpDir,
      model: 'sonnet',
    });

    let runtimeState = getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState!.status, 'running');

    await orchestrator.handlePermissionRequest({
      sessionId: session.id,
      source: 'sdk',
      request: {
        permissionRequestId: 'perm-2',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/demo.ts' },
        toolUseId: 'tool-2',
        description: 'Read demo file',
      },
    });

    runtimeState = getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState!.status, 'waiting_permission');
    assert.match(runtimeState!.pending_permissions, /perm-2/);

    await orchestrator.resolvePermission({
      sessionId: session.id,
      permissionRequestId: 'perm-2',
      approved: true,
      source: 'ui',
      nextStatus: 'running',
    });

    runtimeState = getSessionRuntimeState(session.id);
    assert.ok(runtimeState);
    assert.equal(runtimeState!.status, 'running');
    assert.equal(runtimeState!.pending_permissions, '[]');
    assert.deepEqual(emittedTypes, ['permission.required', 'permission.resolved']);
  });

  it('does not overwrite an error state when completion arrives late', async () => {
    const session = createSession('Late Done', 'sonnet', '', tmpDir);
    const orchestrator = new Orchestrator(new EventBus());

    await orchestrator.startSession({
      sessionId: session.id,
      source: 'sdk',
    });

    orchestrator.markSessionError(session.id, 'boom', 'sdk');
    let runtimeState = getSessionRuntimeState(session.id);
    let sessionRecord = getSession(session.id);

    assert.ok(runtimeState);
    assert.ok(sessionRecord);
    assert.equal(runtimeState!.status, 'error');
    assert.equal(sessionRecord!.runtime_status, 'error');

    orchestrator.handleEvent({
      type: 'session.completed',
      metadata: {
        sessionId: session.id,
        timestamp: Date.now(),
        source: 'sdk',
        rawType: 'done',
        eventId: `${session.id}:done:${Date.now()}`,
      },
      usage: null,
    });

    runtimeState = getSessionRuntimeState(session.id);
    sessionRecord = getSession(session.id);
    assert.ok(runtimeState);
    assert.ok(sessionRecord);
    assert.equal(runtimeState!.status, 'error');
    assert.equal(sessionRecord!.runtime_status, 'error');
  });
});

describe('database runtime helpers', () => {
  afterEach(() => {
    closeDb();
  });

  it('replaces structured message parts atomically', () => {
    const session = createSession('Message Parts', 'sonnet', '', tmpDir);
    const message = addMessage(session.id, 'assistant', 'initial');

    replaceMessageParts(message.id, session.id, [
      { partType: 'text', content: 'hello' },
      { partType: 'tool_use', content: '{"file":"/tmp/demo.ts"}', metadata: { toolName: 'Read' } },
    ]);

    let parts = getMessageParts(message.id);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].part_type, 'text');
    assert.equal(parts[1].part_type, 'tool_use');
    assert.match(parts[1].metadata || '', /Read/);

    replaceMessageParts(message.id, session.id, [
      { partType: 'tool_result', content: 'done', metadata: { success: true } },
    ]);

    parts = getMessageParts(message.id);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].part_type, 'tool_result');
    assert.equal(parts[0].content, 'done');
  });
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
