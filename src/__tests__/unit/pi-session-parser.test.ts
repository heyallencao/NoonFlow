import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-pi-sessions-'));
const sessionsDir = path.join(testDir, 'sessions');
const workspace = path.join(testDir, 'project');
let parser: typeof import('../../lib/pi-session-parser');

function writeSession(sessionId: string): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const lines = [
    { type: 'session', version: 3, id: sessionId, timestamp: '2026-08-09T01:00:00.000Z', cwd: workspace },
    { type: 'message', id: 'm1', parentId: null, timestamp: '2026-08-09T01:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Inspect src/main.ts' }], timestamp: 1786237201000 } },
    { type: 'model_change', id: 'model-1', parentId: 'm1', provider: 'anthropic', modelId: 'claude-sonnet-4', timestamp: '2026-08-09T01:00:01.500Z' },
    { type: 'message', id: 'm2', parentId: 'model-1', timestamp: '2026-08-09T01:00:02.000Z', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-4', content: [{ type: 'thinking', thinking: 'I will inspect it.' }, { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/main.ts' } }], timestamp: 1786237202000 } },
    { type: 'message', id: 'm3', parentId: 'm2', timestamp: '2026-08-09T01:00:03.000Z', message: { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'source' }], isError: false, timestamp: 1786237203000 } },
    { type: 'compaction', id: 'compact-1', parentId: 'm3', summary: 'The source file was inspected.', timestamp: '2026-08-09T01:00:03.500Z' },
    { type: 'message', id: 'm4', parentId: 'compact-1', timestamp: '2026-08-09T01:00:04.000Z', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-4', content: [{ type: 'text', text: 'Done' }], timestamp: 1786237204000 } },
  ];
  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

before(async () => {
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionsDir;
  parser = await import('../../lib/pi-session-parser');
});

beforeEach(() => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
});

after(() => {
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('pi-session-parser', () => {
  it('lists workspace sessions and rebuilds the active native message branch', () => {
    writeSession('pi-native-session');
    const page = parser.listPiSessionPage({ projectPaths: [workspace], limit: 10 });
    assert.equal(page.total, 1);
    assert.equal(page.sessions[0].sessionId, 'pi-native-session');
    assert.equal(page.sessions[0].model, 'anthropic/claude-sonnet-4');
    assert.match(page.sessions[0].preview, /Inspect src\/main\.ts/);
    assert.equal(parser.listPiSessionPage({ projectPaths: ['/missing'] }).total, 0);

    const detail = parser.parsePiSession('pi-native-session');
    assert.ok(detail);
    assert.equal(detail.messages.length, 5);
    assert.ok(detail.messages.some((message) => message.content.includes('Pi compaction summary')));
    assert.ok(detail.messages.some((message) => message.contentBlocks.some((block) => block.type === 'tool_use')));
    assert.ok(detail.messages.some((message) => message.contentBlocks.some((block) => block.type === 'tool_result')));
  });
});
