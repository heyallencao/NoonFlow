import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-widget-telemetry-db-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
fs.closeSync(fs.openSync(path.join(tmpDir, 'monolith.db'), 'w'));

/* eslint-disable @typescript-eslint/no-require-imports */
const dbModule = require('../../lib/db') as typeof import('../../lib/db');

const { closeDb, createSession, getWidgetTelemetryStats, recordWidgetTelemetryEvents } = dbModule;

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('widget telemetry db stats', () => {
  it('persists widget telemetry events and returns aggregates', () => {
    const session = createSession('Widget Telemetry DB', 'claude-sonnet');
    const inserted = recordWidgetTelemetryEvents([
      {
        event: 'widget_parse',
        ok: true,
        sessionId: session.id,
        messageId: 'msg-1',
        traceId: 'trace-1',
        schemaVersion: '1.0',
        meta: { liveStreaming: false },
      },
      {
        event: 'widget_render',
        ok: true,
        code: 'W_RENDER_IFRAME_LOADED',
        sessionId: session.id,
        messageId: 'msg-1',
        traceId: 'trace-1',
        schemaVersion: '1.0',
        meta: { widgetKey: 'widget-1' },
      },
      {
        event: 'widget_render',
        ok: false,
        code: 'W_RENDER_IFRAME_TIMEOUT',
        sessionId: session.id,
        messageId: 'msg-1',
        traceId: 'trace-1',
        schemaVersion: '1.0',
        meta: { widgetKey: 'widget-1' },
      },
    ]);

    assert.equal(inserted, 3);

    const stats = getWidgetTelemetryStats(30);
    assert.equal(stats.summary.totalEvents >= 2, true);
    assert.equal(stats.summary.errorEvents >= 1, true);
    assert.equal(stats.byEvent.some((entry) => entry.event === 'widget_parse'), true);
    assert.equal(stats.byEvent.some((entry) => entry.event === 'widget_render'), true);
    assert.equal(stats.byCode.some((entry) => entry.code === 'W_RENDER_IFRAME_TIMEOUT'), true);
    assert.equal(stats.byCode.some((entry) => entry.code === 'W_RENDER_IFRAME_LOADED'), false);
    assert.equal(stats.recent.some((entry) => entry.sessionId === session.id), true);
  });

  it('applies the same days window to recent rows', () => {
    const session = createSession('Widget Telemetry Recent Window', 'claude-sonnet');
    const now = Date.now();
    const oldCreatedAt = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const freshCreatedAt = new Date(now - 30 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    recordWidgetTelemetryEvents([
      {
        event: 'widget_parse',
        ok: true,
        sessionId: session.id,
        messageId: 'old-msg',
        traceId: 'trace-old',
        schemaVersion: '1.0',
        createdAt: oldCreatedAt,
      },
      {
        event: 'widget_parse',
        ok: true,
        sessionId: session.id,
        messageId: 'fresh-msg',
        traceId: 'trace-fresh',
        schemaVersion: '1.0',
        createdAt: freshCreatedAt,
      },
    ]);

    const stats = getWidgetTelemetryStats(1);
    assert.equal(stats.recent.some((entry) => entry.messageId === 'fresh-msg'), true);
    assert.equal(stats.recent.some((entry) => entry.messageId === 'old-msg'), false);
  });
});
