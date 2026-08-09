import fs from 'node:fs';
import path from 'node:path';

export function installFakeCodexCli(homeDirectory: string): {
  binaryPath: string;
  capturePath: string;
  markerPath: string;
} {
  const binaryDirectory = path.join(homeDirectory, '.local', 'bin');
  const binaryPath = path.join(binaryDirectory, 'codex');
  const capturePath = path.join(homeDirectory, 'fake-codex-requests.jsonl');
  const markerPath = path.join(homeDirectory, 'fake-codex-marker');
  fs.mkdirSync(binaryDirectory, { recursive: true });
  fs.writeFileSync(binaryPath, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli ' + (process.env.FAKE_CODEX_VERSION || '0.145.0') + '\\n');
  process.exit(0);
}
if (args[0] !== 'app-server') {
  process.stderr.write('expected app-server\\n');
  process.exit(2);
}
const capture = process.env.FAKE_CODEX_CAPTURE;
const marker = process.env.FAKE_CODEX_MARKER;
const scenario = process.env.FAKE_CODEX_SCENARIO || 'normal';
const threadId = process.env.FAKE_CODEX_THREAD_ID || 'thread-fake';
let turnCount = 0;
let approvalTurn = null;
let cumulativeTotalTokens = 310;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const turn = (id, status, error = null) => ({
  id, items: [], itemsView: { type: 'full' }, status, error,
  startedAt: null, completedAt: null, durationMs: null
});
const usage = (turnId, currentContextTokens = 110) => {
  cumulativeTotalTokens += currentContextTokens;
  notify('thread/tokenUsage/updated', {
    threadId, turnId, tokenUsage: {
      total: { totalTokens: cumulativeTotalTokens, inputTokens: Math.max(0, cumulativeTotalTokens - 20), cachedInputTokens: 120, cacheWriteInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 0 },
      last: { totalTokens: currentContextTokens, inputTokens: Math.max(0, currentContextTokens - 10), cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 0 },
      modelContextWindow: 1000
    }
  });
};
const finishTurn = (turnId) => {
  usage(turnId);
  notify('item/agentMessage/delta', { threadId, turnId, itemId: 'agent-' + turnId, delta: 'done-' + turnCount });
  notify('item/completed', { threadId, turnId, completedAtMs: Date.now(), item: { type: 'agentMessage', id: 'agent-' + turnId, text: 'done-' + turnCount, phase: null, memoryCitation: null } });
  notify('turn/completed', { threadId, turn: turn(turnId, 'completed') });
};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (capture) fs.appendFileSync(capture, line + '\\n');
  let message;
  try { message = JSON.parse(line); } catch { process.stdout.write('not-json\\n'); return; }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'fake', codexHome: '/tmp/fake', platformFamily: 'unix', platformOs: 'macos' } });
  } else if (message.method === 'initialized') {
  } else if (message.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: message.id, result: { thread: { id: threadId } } });
  } else if (message.method === 'thread/resume') {
    if (scenario === 'resume-fail') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'resume failed' } });
    } else {
      send({ jsonrpc: '2.0', id: message.id, result: { thread: { id: message.params.threadId } } });
    }
  } else if (message.method === 'turn/start') {
    turnCount += 1;
    const turnId = 'turn-' + turnCount;
    send({ jsonrpc: '2.0', id: message.id, result: { turn: turn(turnId, 'inProgress') } });
    if (scenario === 'resume-error-before-event' && marker && !fs.existsSync(marker)) {
      fs.writeFileSync(marker, 'seen');
      notify('error', { error: { message: 'first streamed resume error' } });
      process.exit(6);
    }
    notify('turn/started', { threadId, turn: turn(turnId, 'inProgress') });
    if (scenario === 'process-exit') process.exit(7);
    if (scenario === 'invalid-json') { process.stdout.write('not-json\\n'); return; }
    if (scenario === 'hang') return;
    if (scenario === 'turn-fail') {
      notify('turn/completed', { threadId, turn: turn(turnId, 'failed', { message: 'native turn failed', codexErrorInfo: 'other', additionalDetails: null }) });
      return;
    }
    if (scenario === 'approval') {
      approvalTurn = turnId;
      send({ jsonrpc: '2.0', id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId, turnId, itemId: 'cmd-1', command: 'echo ok', cwd: process.cwd(), reason: 'test approval' } });
      return;
    }
    if ((scenario === 'context-window' || scenario === 'context-window-no-completion' || scenario === 'context-window-no-post-usage' || scenario === 'context-window-twice' || scenario === 'context-window-compact-fatal' || scenario === 'context-window-compact-rpc-error-after-completed' || scenario === 'context-window-compact-rpc-hang-after-completed') && (turnCount === 1 || scenario === 'context-window-twice')) {
      usage(turnId, 900);
      notify('turn/completed', { threadId, turn: turn(turnId, 'failed', { message: 'ContextWindowExceeded', codexErrorInfo: 'contextWindowExceeded', additionalDetails: null }) });
      return;
    }
    if (scenario === 'item-warning') {
      notify('item/completed', { threadId, turnId, item: { type: 'error', id: 'warning-1', message: 'non-terminal warning' } });
      finishTurn(turnId);
      return;
    }
    if (scenario === 'item-error-exit') {
      notify('item/completed', { threadId, turnId, item: { type: 'error', id: 'error-1', message: 'item failure before exit' } });
      process.exit(8);
    }
    if (scenario === 'multiple-agent-messages') {
      notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: 'agent-analysis', text: 'analysis note' } });
    }
    if (scenario === 'child-activity') {
      notify('item/started', { threadId, turnId, item: { type: 'collabAgentToolCall', id: 'collab-1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: threadId, receiverThreadIds: ['thread-child'], agentsStates: { 'thread-child': { status: 'running', message: 'Starting tester' } }, prompt: 'private prompt' } });
      notify('item/completed', { threadId, turnId, item: { type: 'subAgentActivity', id: 'subactivity-started', agentThreadId: 'thread-child', agentPath: 'root/tester', kind: 'started' } });
      notify('item/completed', { threadId, turnId, item: { type: 'subAgentActivity', id: 'subactivity-interacted', agentThreadId: 'thread-child', agentPath: 'root/tester', kind: 'interacted' } });
      notify('item/completed', { threadId, turnId, item: { type: 'collabAgentToolCall', id: 'collab-1', tool: 'spawnAgent', status: 'completed', senderThreadId: threadId, receiverThreadIds: ['thread-child'], agentsStates: { 'thread-child': { status: 'completed', message: 'Tester ready' } } } });
    }
    finishTurn(turnId);
  } else if (message.method === 'thread/compact/start') {
    const rpcErrorAfterCompleted = scenario === 'context-window-compact-rpc-error-after-completed';
    const rpcHangsAfterCompleted = scenario === 'context-window-compact-rpc-hang-after-completed';
    if (!rpcErrorAfterCompleted && !rpcHangsAfterCompleted) send({ jsonrpc: '2.0', id: message.id, result: {} });
    notify('thread/compacted', { threadId, turnId: 'compact-turn' });
    notify('turn/completed', { threadId, turn: turn('compact-turn', 'completed') });
    if (scenario === 'context-window-no-completion') {
      notify('item/completed', { threadId, turnId: 'compact-turn', item: { type: 'agentMessage', id: 'ordinary-1', text: 'ordinary item' } });
      return;
    }
    if (scenario !== 'context-window-no-post-usage') usage('compact-turn', 300);
    notify('item/started', { threadId, turnId: 'compact-turn', startedAtMs: 1111, item: { type: 'contextCompaction', id: 'compact-1' } });
    if (scenario === 'context-window-compact-fatal') process.exit(9);
    notify('item/completed', { threadId, turnId: 'compact-turn', completedAtMs: 2222, item: { type: 'contextCompaction', id: 'compact-1' } });
    if (rpcErrorAfterCompleted) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'compact rpc failed after completed item' } });
    }
  } else if (message.method === 'turn/interrupt') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
  } else if (message.id === 'approval-1') {
    if (message.result && message.result.decision === 'accept') finishTurn(approvalTurn);
    else notify('turn/completed', { threadId, turn: turn(approvalTurn, 'failed', { message: 'declined', codexErrorInfo: 'other', additionalDetails: null }) });
  }
});
`, 'utf8');
  fs.chmodSync(binaryPath, 0o755);
  return { binaryPath, capturePath, markerPath };
}

export function readFakeCodexRequests(capturePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(capturePath)) return [];
  return fs.readFileSync(capturePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
