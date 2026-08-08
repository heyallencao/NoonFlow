import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

const previousTz = process.env.TZ;
process.env.TZ = 'Asia/Shanghai';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-context-budget-stats-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const dbModule = require('../../lib/db') as typeof import('../../lib/db');
const contextBudgetModule = require('../../lib/context-budget') as typeof import('../../lib/context-budget');
const routeModule = require('../../app/api/context-budget/stats/route') as typeof import('../../app/api/context-budget/stats/route');

const { closeDb, createSession, getContextBudgetStats, getDb, recordContextBudgetEvent, updateContextBudgetRecoveryMetrics } = dbModule;
const { buildContextBudgetLogFields, prepareConversationContext } = contextBudgetModule;
const { GET: getContextBudgetStatsRoute } = routeModule;

function toDbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toCount(value: boolean | number | string | undefined): number {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseInt(value, 10) || 0;
  }
  return 0;
}

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (previousTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTz;
  }
});

describe('context budget stats', () => {
  it('persists and aggregates context budget events', async () => {
    const limits = {
      warningLimit: 500,
      softLimit: 700,
      hardLimit: 900,
    };
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const sessionA = createSession('Context Budget UI', 'claude-sonnet');
    const sessionB = createSession('Context Budget Codex', 'gpt-5-codex');

    const warningContext = prepareConversationContext({
      runtime: 'claude',
      prompt: 'w'.repeat(520),
      conversationHistory: [],
      useConversationHistory: true,
      includeSystemPrompt: false,
      limits,
    });
    const compactingHistory = [
      { role: 'user' as const, content: 'u'.repeat(420) },
      { role: 'assistant' as const, content: 'a'.repeat(420) },
      { role: 'user' as const, content: 'v'.repeat(420) },
      { role: 'assistant' as const, content: 'b'.repeat(420) },
    ];
    const softContext = prepareConversationContext({
      runtime: 'claude',
      prompt: 'summarize the latest changes',
      systemPrompt: 'Keep responses concise.',
      conversationHistory: compactingHistory,
      useConversationHistory: true,
      includeSystemPrompt: true,
      limits,
    });
    const hardContext = prepareConversationContext({
      runtime: 'codex',
      prompt: 'x'.repeat(1_100),
      conversationHistory: [],
      useConversationHistory: true,
      includeSystemPrompt: false,
      nativeResumeActive: true,
      limits,
    });

    const recorded = [
      {
        eventId: recordContextBudgetEvent({
          sessionId: sessionA.id,
          source: 'ui',
          assistantRuntime: 'claude_code',
          context: warningContext,
          historyBeforeCount: 0,
        }),
        fields: buildContextBudgetLogFields(warningContext, 0),
        source: 'ui' as const,
        assistantRuntime: 'claude_code',
      },
      {
        eventId: recordContextBudgetEvent({
          sessionId: sessionA.id,
          source: 'bridge',
          assistantRuntime: 'claude_code',
          context: softContext,
          historyBeforeCount: compactingHistory.length,
        }),
        fields: buildContextBudgetLogFields(softContext, compactingHistory.length),
        source: 'bridge' as const,
        assistantRuntime: 'claude_code',
        recovery: {
          officialCompactAttempted: true,
          officialCompactSuccess: true,
          compactRetrySuccess: true,
          recoveryDurationMs: 1234,
        },
      },
      {
        eventId: recordContextBudgetEvent({
          sessionId: sessionB.id,
          source: 'ui',
          assistantRuntime: 'codex',
          context: hardContext,
          historyBeforeCount: 0,
        }),
        fields: buildContextBudgetLogFields(hardContext, 0),
        source: 'ui' as const,
        assistantRuntime: 'codex',
        recovery: {
          officialCompactAttempted: true,
          officialCompactSuccess: false,
          compactRetrySuccess: false,
          recoveryDurationMs: null,
        },
      },
    ];

    for (const entry of recorded) {
      if (entry.recovery) {
        updateContextBudgetRecoveryMetrics(entry.eventId, entry.recovery);
      }
    }

    assert.equal(recorded[0].fields.warning_limit_hit, true);
    assert.equal(recorded[0].fields.soft_limit_hit, false);
    assert.equal(recorded[1].fields.local_compaction_attempted, true);
    assert.equal(recorded[2].fields.hard_limit_hit, true);

    const db = getDb();
    db.prepare('UPDATE context_budget_events SET created_at = ? WHERE id = ?').run(toDbTimestamp(yesterday), recorded[0].eventId);
    db.prepare('UPDATE context_budget_events SET created_at = ? WHERE id = ?').run(toDbTimestamp(now), recorded[1].eventId);
    db.prepare('UPDATE context_budget_events SET created_at = ? WHERE id = ?').run(toDbTimestamp(now), recorded[2].eventId);

    const stats = getContextBudgetStats(7);
    const recordedWithDates = [
      { ...recorded[0], date: toLocalDateKey(yesterday) },
      { ...recorded[1], date: toLocalDateKey(now) },
      { ...recorded[2], date: toLocalDateKey(now) },
    ];

    const expectedSummary = recordedWithDates.reduce((accumulator, entry) => {
      const compiledInputChars = toCount(entry.fields.compiled_input_chars);
      accumulator.totalEvents += 1;
      accumulator.warningLimitHitCount += toCount(entry.fields.warning_limit_hit);
      accumulator.softLimitHitCount += toCount(entry.fields.soft_limit_hit);
      accumulator.inputOverLimitCount += toCount(entry.fields.hard_limit_hit);
      accumulator.softLimitCompactionCount += toCount(entry.fields.local_compaction_attempted);
      accumulator.localCompactionAppliedCount += toCount(entry.fields.local_compaction_applied);
      accumulator.hardTrimAppliedCount += toCount(entry.fields.hard_trim_applied);
      accumulator.nativeResumeActiveCount += toCount(entry.fields.native_resume_active);
      accumulator.officialCompactAttemptCount += toCount(entry.recovery?.officialCompactAttempted);
      accumulator.officialCompactSuccessCount += toCount(entry.recovery?.officialCompactSuccess);
      accumulator.compactRetrySuccessCount += toCount(entry.recovery?.compactRetrySuccess);
      if (typeof entry.recovery?.recoveryDurationMs === 'number') {
        accumulator.totalRecoveryDurationMs += entry.recovery.recoveryDurationMs;
        accumulator.maxRecoveryDurationMs = Math.max(accumulator.maxRecoveryDurationMs, entry.recovery.recoveryDurationMs);
        accumulator.recoveryDurationSamples += 1;
      }
      accumulator.maxCompiledInputChars = Math.max(accumulator.maxCompiledInputChars, compiledInputChars);
      accumulator.totalCompiledInputChars += compiledInputChars;
      return accumulator;
    }, {
      totalEvents: 0,
      warningLimitHitCount: 0,
      softLimitHitCount: 0,
      inputOverLimitCount: 0,
      softLimitCompactionCount: 0,
      localCompactionAppliedCount: 0,
      hardTrimAppliedCount: 0,
      nativeResumeActiveCount: 0,
      officialCompactAttemptCount: 0,
      officialCompactSuccessCount: 0,
      compactRetrySuccessCount: 0,
      totalRecoveryDurationMs: 0,
      maxRecoveryDurationMs: 0,
      recoveryDurationSamples: 0,
      maxCompiledInputChars: 0,
      totalCompiledInputChars: 0,
    });

    assert.equal(stats.summary.totalEvents, expectedSummary.totalEvents);
    assert.equal(stats.summary.warningLimitHitCount, expectedSummary.warningLimitHitCount);
    assert.equal(stats.summary.softLimitHitCount, expectedSummary.softLimitHitCount);
    assert.equal(stats.summary.inputOverLimitCount, expectedSummary.inputOverLimitCount);
    assert.equal(stats.summary.softLimitCompactionCount, expectedSummary.softLimitCompactionCount);
    assert.equal(stats.summary.localCompactionAppliedCount, expectedSummary.localCompactionAppliedCount);
    assert.equal(stats.summary.hardTrimAppliedCount, expectedSummary.hardTrimAppliedCount);
    assert.equal(stats.summary.nativeResumeActiveCount, expectedSummary.nativeResumeActiveCount);
    assert.equal(stats.summary.officialCompactAttemptCount, expectedSummary.officialCompactAttemptCount);
    assert.equal(stats.summary.officialCompactSuccessCount, expectedSummary.officialCompactSuccessCount);
    assert.equal(stats.summary.compactRetrySuccessCount, expectedSummary.compactRetrySuccessCount);
    assert.equal(
      stats.summary.avgRecoveryDurationMs,
      expectedSummary.recoveryDurationSamples > 0
        ? expectedSummary.totalRecoveryDurationMs / expectedSummary.recoveryDurationSamples
        : 0,
    );
    assert.equal(stats.summary.maxRecoveryDurationMs, expectedSummary.maxRecoveryDurationMs);
    assert.equal(stats.summary.maxCompiledInputChars, expectedSummary.maxCompiledInputChars);
    assert.equal(
      stats.summary.avgCompiledInputChars,
      expectedSummary.totalCompiledInputChars / expectedSummary.totalEvents,
    );

    const expectedBySource = Array.from(recordedWithDates.reduce((accumulator, entry) => {
      const current = accumulator.get(entry.source) ?? {
        source: entry.source,
        totalEvents: 0,
        warningLimitHitCount: 0,
        softLimitHitCount: 0,
        inputOverLimitCount: 0,
        softLimitCompactionCount: 0,
        localCompactionAppliedCount: 0,
        officialCompactAttemptCount: 0,
        officialCompactSuccessCount: 0,
        compactRetrySuccessCount: 0,
      };
      current.totalEvents += 1;
      current.warningLimitHitCount += toCount(entry.fields.warning_limit_hit);
      current.softLimitHitCount += toCount(entry.fields.soft_limit_hit);
      current.inputOverLimitCount += toCount(entry.fields.hard_limit_hit);
      current.softLimitCompactionCount += toCount(entry.fields.local_compaction_attempted);
      current.localCompactionAppliedCount += toCount(entry.fields.local_compaction_applied);
      current.officialCompactAttemptCount += toCount(entry.recovery?.officialCompactAttempted);
      current.officialCompactSuccessCount += toCount(entry.recovery?.officialCompactSuccess);
      current.compactRetrySuccessCount += toCount(entry.recovery?.compactRetrySuccess);
      accumulator.set(entry.source, current);
      return accumulator;
    }, new Map<string, {
      source: 'ui' | 'bridge';
      totalEvents: number;
      warningLimitHitCount: number;
      softLimitHitCount: number;
      inputOverLimitCount: number;
      softLimitCompactionCount: number;
      localCompactionAppliedCount: number;
      officialCompactAttemptCount: number;
      officialCompactSuccessCount: number;
      compactRetrySuccessCount: number;
    }>()).values()).sort((left, right) => {
      if (right.totalEvents !== left.totalEvents) {
        return right.totalEvents - left.totalEvents;
      }
      return left.source.localeCompare(right.source);
    });
    assert.deepEqual(stats.bySource, expectedBySource);

    const expectedByRuntime = Array.from(recordedWithDates.reduce((accumulator, entry) => {
      const current = accumulator.get(entry.assistantRuntime) ?? {
        assistantRuntime: entry.assistantRuntime,
        totalEvents: 0,
        warningLimitHitCount: 0,
        softLimitHitCount: 0,
        inputOverLimitCount: 0,
        softLimitCompactionCount: 0,
        localCompactionAppliedCount: 0,
        officialCompactAttemptCount: 0,
        officialCompactSuccessCount: 0,
        compactRetrySuccessCount: 0,
      };
      current.totalEvents += 1;
      current.warningLimitHitCount += toCount(entry.fields.warning_limit_hit);
      current.softLimitHitCount += toCount(entry.fields.soft_limit_hit);
      current.inputOverLimitCount += toCount(entry.fields.hard_limit_hit);
      current.softLimitCompactionCount += toCount(entry.fields.local_compaction_attempted);
      current.localCompactionAppliedCount += toCount(entry.fields.local_compaction_applied);
      current.officialCompactAttemptCount += toCount(entry.recovery?.officialCompactAttempted);
      current.officialCompactSuccessCount += toCount(entry.recovery?.officialCompactSuccess);
      current.compactRetrySuccessCount += toCount(entry.recovery?.compactRetrySuccess);
      accumulator.set(entry.assistantRuntime, current);
      return accumulator;
    }, new Map<string, {
      assistantRuntime: string;
      totalEvents: number;
      warningLimitHitCount: number;
      softLimitHitCount: number;
      inputOverLimitCount: number;
      softLimitCompactionCount: number;
      localCompactionAppliedCount: number;
      officialCompactAttemptCount: number;
      officialCompactSuccessCount: number;
      compactRetrySuccessCount: number;
    }>()).values()).sort((left, right) => {
      if (right.totalEvents !== left.totalEvents) {
        return right.totalEvents - left.totalEvents;
      }
      return left.assistantRuntime.localeCompare(right.assistantRuntime);
    });
    assert.deepEqual(stats.byRuntime, expectedByRuntime);

    const expectedDaily = Array.from(recordedWithDates.reduce((accumulator, entry) => {
      const current = accumulator.get(entry.date) ?? {
        date: entry.date,
        totalEvents: 0,
        warningLimitHitCount: 0,
        softLimitHitCount: 0,
        inputOverLimitCount: 0,
        softLimitCompactionCount: 0,
        officialCompactAttemptCount: 0,
        officialCompactSuccessCount: 0,
        compactRetrySuccessCount: 0,
      };
      current.totalEvents += 1;
      current.warningLimitHitCount += toCount(entry.fields.warning_limit_hit);
      current.softLimitHitCount += toCount(entry.fields.soft_limit_hit);
      current.inputOverLimitCount += toCount(entry.fields.hard_limit_hit);
      current.softLimitCompactionCount += toCount(entry.fields.local_compaction_attempted);
      current.officialCompactAttemptCount += toCount(entry.recovery?.officialCompactAttempted);
      current.officialCompactSuccessCount += toCount(entry.recovery?.officialCompactSuccess);
      current.compactRetrySuccessCount += toCount(entry.recovery?.compactRetrySuccess);
      accumulator.set(entry.date, current);
      return accumulator;
    }, new Map<string, {
      date: string;
      totalEvents: number;
      warningLimitHitCount: number;
      softLimitHitCount: number;
      inputOverLimitCount: number;
      softLimitCompactionCount: number;
      officialCompactAttemptCount: number;
      officialCompactSuccessCount: number;
      compactRetrySuccessCount: number;
    }>()).values());
    for (const expectedDay of expectedDaily) {
      const actualDay = stats.daily.find((entry) => entry.date === expectedDay.date);
      assert.deepEqual(actualDay, expectedDay);
    }

    const expectedByStageAfter = Array.from(recordedWithDates.reduce((accumulator, entry) => {
      const stage = String(entry.fields.budget_stage_after);
      accumulator.set(stage, (accumulator.get(stage) ?? 0) + 1);
      return accumulator;
    }, new Map<string, number>()).entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.stage.localeCompare(right.stage);
      });
    assert.deepEqual(stats.byStageAfter, expectedByStageAfter);

    assert.equal(stats.recentHardLimitHits.length, 1);
    assert.equal(stats.recentHardLimitHits[0]?.assistantRuntime, 'codex');
    assert.equal(stats.recentHardLimitHits[0]?.source, 'ui');
    assert.equal(stats.recentHardLimitHits[0]?.sessionId, sessionB.id);
    assert.equal(stats.recentRecoveries.length, 2);
    const successfulRecovery = stats.recentRecoveries.find((entry) => entry.sessionId === sessionA.id && entry.source === 'bridge');
    const failedRecovery = stats.recentRecoveries.find((entry) => entry.sessionId === sessionB.id && entry.source === 'ui');
    assert.ok(successfulRecovery);
    assert.ok(failedRecovery);
    assert.equal(Boolean(failedRecovery?.officialCompactSuccess), false);
    assert.equal(Boolean(failedRecovery?.compactRetrySuccess), false);
    assert.equal(failedRecovery?.recoveryDurationMs, null);
    assert.equal(Boolean(successfulRecovery?.officialCompactSuccess), true);
    assert.equal(Boolean(successfulRecovery?.compactRetrySuccess), true);
    assert.equal(successfulRecovery?.recoveryDurationMs, 1234);

    const response = await getContextBudgetStatsRoute(
      new NextRequest('http://localhost/api/context-budget/stats?days=7'),
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as ReturnType<typeof getContextBudgetStats>;
    assert.equal(payload.summary.totalEvents, 3);
    assert.equal(payload.summary.inputOverLimitCount, 1);
    assert.equal(payload.summary.officialCompactAttemptCount, 2);
    assert.equal(payload.summary.compactRetrySuccessCount, 1);
  });
});
