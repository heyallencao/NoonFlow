import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-token-usage-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const { addMessage, closeDb, createSession, getDb, getTokenUsageStats } = require('../../lib/db') as typeof import('../../lib/db');

function toDbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfLocalWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  return start;
}

function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function closeEnough(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getTokenUsageStats', () => {
  it('returns real period totals and chart data without mock fallbacks', () => {
    const now = new Date();
    const weekStart = startOfLocalWeek(now);
    const monthStart = startOfLocalMonth(now);
    const oldDate = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45));

    const gptSession = createSession('GPT Session', 'gpt-4');
    const sonnetSession = createSession('Sonnet Session', 'sonnet-3.5');
    const oldCodexSession = createSession('Old Codex Session', 'gpt-5-codex');

    const todayMessage = addMessage(
      gptSession.id,
      'assistant',
      'today',
      JSON.stringify({ input_tokens: 100, output_tokens: 50, cost_usd: 1.25 })
    );
    const weekMessage = addMessage(
      gptSession.id,
      'assistant',
      'week',
      JSON.stringify({ input_tokens: 80, output_tokens: 40, cost_usd: 2.5 })
    );
    const monthMessage = addMessage(
      sonnetSession.id,
      'assistant',
      'month',
      JSON.stringify({ input_tokens: 60, output_tokens: 30, cost_usd: 1.75 })
    );
    const oldMessage = addMessage(
      sonnetSession.id,
      'assistant',
      'old',
      JSON.stringify({ input_tokens: 40, output_tokens: 20, cost_usd: 4.5 })
    );
    const oldCodexMessage = addMessage(
      oldCodexSession.id,
      'assistant',
      'old codex',
      JSON.stringify({ input_tokens: 10, output_tokens: 5, cost_usd: 6.0 })
    );

    const db = getDb();
    db.prepare("UPDATE chat_sessions SET assistant_runtime = 'codex' WHERE id = ?").run(oldCodexSession.id);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(toDbTimestamp(now), todayMessage.id);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(toDbTimestamp(weekStart), weekMessage.id);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(toDbTimestamp(monthStart), monthMessage.id);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(toDbTimestamp(oldDate), oldMessage.id);
    db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(toDbTimestamp(oldDate), oldCodexMessage.id);

    const stats = getTokenUsageStats(30);

    const todayStart = toDbTimestamp(startOfLocalDay(now));
    const weekStartTs = toDbTimestamp(weekStart);
    const monthStartTs = toDbTimestamp(monthStart);
    const recentMessages = [
      { model: 'gpt-4', cost: 1.25, createdAt: toDbTimestamp(now) },
      { model: 'gpt-4', cost: 2.5, createdAt: toDbTimestamp(weekStart) },
      { model: 'sonnet-3.5', cost: 1.75, createdAt: toDbTimestamp(monthStart) },
    ];
    const allMessages = [
      ...recentMessages,
      { model: 'sonnet-3.5', cost: 4.5, createdAt: toDbTimestamp(oldDate) },
      { model: 'gpt-5-codex', cost: 6.0, createdAt: toDbTimestamp(oldDate) },
    ];

    const expectedToday = allMessages
      .filter((message) => message.createdAt >= todayStart)
      .reduce((sum, message) => sum + message.cost, 0);
    const expectedWeek = allMessages
      .filter((message) => message.createdAt >= weekStartTs)
      .reduce((sum, message) => sum + message.cost, 0);
    const expectedMonth = allMessages
      .filter((message) => message.createdAt >= monthStartTs)
      .reduce((sum, message) => sum + message.cost, 0);
    const expectedTotal = allMessages.reduce((sum, message) => sum + message.cost, 0);
    const expectedByModel = Array.from(
      recentMessages.reduce((accumulator, message) => {
        accumulator.set(message.model, (accumulator.get(message.model) ?? 0) + message.cost);
        return accumulator;
      }, new Map<string, number>()).entries()
    )
      .map(([model, cost]) => ({ model, cost }))
      .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

    closeEnough(stats.periods.todayCost, expectedToday);
    closeEnough(stats.periods.weekCost, expectedWeek);
    closeEnough(stats.periods.monthCost, expectedMonth);
    closeEnough(stats.periods.totalCost, expectedTotal);
    assert.equal(stats.dailyCosts.length, 30);
    assert.equal(stats.weeklyTrend.length, 7);
    assert.deepEqual(stats.byModel, expectedByModel);
    assert.deepEqual(stats.byRuntime, [
      {
        runtime: 'claude_code',
        cost: 5.5,
        sessions: 2,
      },
    ]);
  });
});
