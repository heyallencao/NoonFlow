import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-parser-'));
const CODEX_DIR = path.join(TEST_DIR, '.codex');
const ROLLOUTS_DIR = path.join(TEST_DIR, 'rollouts');
const STATE_DB_PATH = path.join(CODEX_DIR, 'state_1.sqlite');
const parserPath = path.resolve(__dirname, '../../lib/codex-session-parser.ts');

function createRolloutFile(sessionId: string, lines: object[]): string {
  fs.mkdirSync(ROLLOUTS_DIR, { recursive: true });
  const filePath = path.join(ROLLOUTS_DIR, `${sessionId}.jsonl`);
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return filePath;
}

function createStateDb(): Database.Database {
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  const db = new Database(STATE_DB_PATH);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      git_branch TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      has_user_event INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

describe('codex-session-parser', () => {
  let parser: typeof import('../../lib/codex-session-parser');

  before(async () => {
    process.env.HOME = TEST_DIR;
    parser = await import(parserPath);
  });

  beforeEach(() => {
    fs.rmSync(CODEX_DIR, { recursive: true, force: true });
    fs.rmSync(ROLLOUTS_DIR, { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.HOME = os.homedir();
  });

  it('prefers the concrete turn_context model over model_provider in session info', () => {
    const sessionId = 'codex-session-model';
    const rolloutPath = createRolloutFile(sessionId, [
      {
        timestamp: '2026-03-12T08:35:06.942Z',
        type: 'session_meta',
        payload: {
          timestamp: '2026-03-12T08:35:06.942Z',
          cli_version: '0.99.0',
          model_provider: 'rightcode',
        },
      },
      {
        timestamp: '2026-03-12T08:35:10.164Z',
        type: 'turn_context',
        payload: {
          model: 'gpt-5.2-codex',
        },
      },
      {
        timestamp: '2026-03-12T08:35:11.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ text: 'Fix the bug' }],
        },
      },
      {
        timestamp: '2026-03-12T08:35:12.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call_patch',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** End Patch',
        },
      },
      {
        timestamp: '2026-03-12T08:35:12.200Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_patch',
          output: '{"output":"Success"}',
        },
      },
    ]);

    const db = createStateDb();
    db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        model_provider,
        cwd,
        title,
        git_branch,
        cli_version,
        first_user_message,
        has_user_event
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      rolloutPath,
      1741768506,
      1741768512,
      'rightcode',
      '/tmp/demo-project',
      'Fix the bug',
      'main',
      '0.99.0',
      'Fix the bug',
      1,
    );
    db.close();

    const sessions = parser.listCodexSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].model, 'gpt-5.2-codex');
    assert.equal(sessions[0].assistantMessageCount, 1);

    const openedPage = parser.listCodexSessionPage({
      projectPaths: ['/tmp/demo-project'],
      limit: 1,
    });
    assert.equal(openedPage.total, 1);
    assert.deepEqual(openedPage.sessions.map((session) => session.sessionId), [sessionId]);
    assert.equal(
      parser.listCodexSessionPage({ projectPaths: ['/tmp/not-opened'], limit: 1 }).total,
      0,
    );
  });

  it('parses custom tool call events into replay tool blocks', () => {
    const sessionId = 'codex-session-tools';
    const rolloutPath = createRolloutFile(sessionId, [
      {
        timestamp: '2026-03-12T08:35:06.942Z',
        type: 'session_meta',
        payload: {
          timestamp: '2026-03-12T08:35:06.942Z',
          cli_version: '0.99.0',
          model_provider: 'openai',
        },
      },
      {
        timestamp: '2026-03-12T08:35:10.164Z',
        type: 'turn_context',
        payload: {
          model: 'gpt-5-codex',
        },
      },
      {
        timestamp: '2026-03-12T08:35:11.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ text: 'Update the file' }],
        },
      },
      {
        timestamp: '2026-03-12T08:35:12.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call_apply_patch',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: demo.ts\n*** End Patch',
        },
      },
      {
        timestamp: '2026-03-12T08:35:12.300Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_apply_patch',
          output: '{"output":"Success. Updated the following files:\\nM demo.ts\\n"}',
        },
      },
    ]);

    const db = createStateDb();
    db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        created_at,
        updated_at,
        model_provider,
        cwd,
        title,
        git_branch,
        cli_version,
        first_user_message,
        has_user_event
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      rolloutPath,
      1741768506,
      1741768512,
      'openai',
      '/tmp/demo-project',
      'Update the file',
      'main',
      '0.99.0',
      'Update the file',
      1,
    );
    db.close();

    const result = parser.parseCodexSession(sessionId);
    assert.ok(result);
    assert.equal(result!.info.model, 'gpt-5-codex');
    assert.equal(result!.messages.length, 2);

    const toolMessage = result!.messages[1];
    assert.equal(toolMessage.role, 'assistant');
    assert.equal(toolMessage.hasToolBlocks, true);
    assert.equal(toolMessage.contentBlocks.length, 2);
    assert.equal(toolMessage.contentBlocks[0].type, 'tool_use');
    assert.equal(toolMessage.contentBlocks[1].type, 'tool_result');

    if (toolMessage.contentBlocks[0].type === 'tool_use') {
      assert.equal(toolMessage.contentBlocks[0].id, 'call_apply_patch');
      assert.equal(toolMessage.contentBlocks[0].name, 'apply_patch');
      assert.equal(
        toolMessage.contentBlocks[0].input,
        '*** Begin Patch\n*** Update File: demo.ts\n*** End Patch',
      );
    }

    if (toolMessage.contentBlocks[1].type === 'tool_result') {
      assert.equal(toolMessage.contentBlocks[1].tool_use_id, 'call_apply_patch');
      assert.equal(toolMessage.contentBlocks[1].content, '{"output":"Success. Updated the following files:\\nM demo.ts\\n"}');
    }
  });
});
