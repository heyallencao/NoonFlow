import { test, expect } from '@playwright/test';
import {
  goToConversation,
  sendMessage,
} from '../helpers';

function buildMockSession(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    title: 'Widget E2E Session',
    created_at: '2026-03-22 10:00:00',
    updated_at: '2026-03-22 10:00:00',
    session_type: 'chat',
    model: 'gpt-5',
    system_prompt: '',
    working_directory: '/tmp/monolith-e2e-widget',
    sdk_session_id: '',
    project_name: 'Monolith',
    status: 'active',
    mode: 'code',
    provider_name: '',
    provider_id: '',
    sdk_cwd: '',
    runtime_status: 'idle',
    runtime_updated_at: '2026-03-22 10:00:00',
    runtime_error: '',
    assistant_runtime: 'codex',
    assistant_runtime_version: '',
    ...overrides,
  };
}

async function mockConversationPage(
  page: import('@playwright/test').Page,
  sessionId: string,
) {
  const session = buildMockSession(sessionId);

  await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session,
        recovery: null,
        runtimeState: null,
      }),
    });
  });

  await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [],
        hasMore: false,
      }),
    });
  });

  await page.route('**/api/chat/sessions?type=all**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [session],
      }),
    });
  });
}

interface MockStreamTurn {
  chunks: string[];
  keepOpen?: boolean;
  chunkDelayMs?: number;
  closeDelayMs?: number;
}

test.describe('Show Widget Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const encoder = new TextEncoder();
      const state = window as unknown as {
        __widgetTurnQueue?: Array<Record<string, unknown>>;
        __widgetPostedPrompts?: string[];
        __widgetBridgeMessages?: string[];
      };
      if (!Array.isArray(state.__widgetTurnQueue)) {
        state.__widgetTurnQueue = [];
      }
      if (!Array.isArray(state.__widgetPostedPrompts)) {
        state.__widgetPostedPrompts = [];
      }
      if (!Array.isArray(state.__widgetBridgeMessages)) {
        state.__widgetBridgeMessages = [];
      }

      window.addEventListener('message', (event) => {
        const data = event.data as { source?: string; type?: string; content?: string; href?: string } | null;
        if (!data || data.source !== 'monolith-widget') {
          return;
        }
        state.__widgetBridgeMessages?.push(`${data.type || 'unknown'}:${data.content || data.href || ''}`);
      });

      window.fetch = async (input, init) => {
        const request = input instanceof Request ? input : null;
        const resource = typeof input === 'string' ? input : request?.url ?? String(input);
        const url = new URL(resource, window.location.href);
        const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

        if (url.pathname === '/api/chat/stop' && method === 'POST') {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/api/chat' && method === 'POST') {
          const rawBody = typeof init?.body === 'string'
            ? init.body
            : request
              ? await request.clone().text()
              : '';
          try {
            const parsed = rawBody ? JSON.parse(rawBody) as { content?: unknown } : {};
            state.__widgetPostedPrompts?.push(String(parsed.content || ''));
          } catch {
            state.__widgetPostedPrompts?.push('');
          }

          const queue = Array.isArray(state.__widgetTurnQueue) ? state.__widgetTurnQueue : [];
          const turn = (queue.shift() || { chunks: ['No mocked response'], keepOpen: false }) as {
            chunks?: unknown[];
            keepOpen?: boolean;
            chunkDelayMs?: number;
            closeDelayMs?: number;
          };

          const chunks = Array.isArray(turn.chunks) ? turn.chunks.map((item) => String(item)) : ['No mocked response'];
          const chunkDelayMs = Number(turn.chunkDelayMs || 60);
          const closeDelayMs = Number(turn.closeDelayMs || 200);

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              chunks.forEach((chunk, index) => {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: chunk })}\n\n`));
                }, chunkDelayMs * (index + 1));
              });

              if (!turn.keepOpen) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`));
                }, chunkDelayMs * (chunks.length + 1));
                window.setTimeout(() => controller.close(), chunkDelayMs * (chunks.length + 1) + closeDelayMs);
              } else {
                window.setTimeout(() => controller.close(), chunkDelayMs * (chunks.length + 1) + 1200);
              }
            },
          });

          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }

        return originalFetch(input, init);
      };
    });
  });

  test('renders widget container and iframe for valid show-widget response', async ({ page }) => {
    const sessionId = 'e2e-widget-valid';
    const reply = [
      'Sales overview:',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg width=\\"300\\" height=\\"120\\"><rect width=\\"300\\" height=\\"120\\" fill=\\"#1f2a44\\"/><rect x=\\"20\\" y=\\"40\\" width=\\"50\\" height=\\"60\\" fill=\\"#45b0ff\\"/></svg>"}',
      '```',
    ].join('\n');

    await mockConversationPage(page, sessionId);
    await page.addInitScript(({ scriptedTurns }) => {
      (window as unknown as { __widgetTurnQueue?: MockStreamTurn[] }).__widgetTurnQueue = scriptedTurns;
    }, { scriptedTurns: [{ chunks: [reply], keepOpen: false }] });
    await goToConversation(page, sessionId);
    await sendMessage(page, 'render widget');

    await expect(page.locator('[data-widget-container="true"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-widget-iframe="true"]').first()).toBeVisible();
    await expect(page.locator('.is-assistant').filter({ hasText: 'Sales overview:' }).first()).toBeVisible();
  });

  test('shows invalid banner for malformed show-widget payload', async ({ page }) => {
    const sessionId = 'e2e-widget-malformed';
    const malformedReply = [
      'Malformed widget payload:',
      '```show-widget',
      '{"title":"broken","widget_code":<svg></svg>}',
      '```',
    ].join('\n');

    await mockConversationPage(page, sessionId);
    await page.addInitScript(({ scriptedTurns }) => {
      (window as unknown as { __widgetTurnQueue?: MockStreamTurn[] }).__widgetTurnQueue = scriptedTurns;
    }, { scriptedTurns: [{ chunks: [malformedReply], keepOpen: false }] });
    await goToConversation(page, sessionId);
    await sendMessage(page, 'render malformed widget');

    await expect(page.locator('[data-widget-invalid="true"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('sends a follow-up turn when clicking ask links inside a widget', async ({ page }) => {
    const sessionId = 'e2e-widget-ask-link';
    const widgetReply = [
      'Interactive widget:',
      '```show-widget',
      '{"title":"actions","widget_code":"<div><a href=\\"ask:refine the chart\\">Refine</a></div>"}',
      '```',
    ].join('\n');

    await mockConversationPage(page, sessionId);
    await page.addInitScript(({ scriptedTurns }) => {
      (window as unknown as { __widgetTurnQueue?: MockStreamTurn[] }).__widgetTurnQueue = scriptedTurns;
    }, {
      scriptedTurns: [
        { chunks: [widgetReply], keepOpen: false },
        { chunks: ['Follow-up received.'], keepOpen: false },
      ],
    });
    await goToConversation(page, sessionId);
    await sendMessage(page, 'show widget');

    await expect(page.locator('[data-widget-iframe="true"]').first()).toBeVisible({ timeout: 10_000 });
    await page.frameLocator('[data-widget-iframe="true"]').first().getByText('Refine').click();

    await expect.poll(async () => page.evaluate(() => {
      const state = window as unknown as { __widgetBridgeMessages?: string[] };
      return state.__widgetBridgeMessages || [];
    }), { timeout: 10_000 }).toContain('ask:refine the chart');

    await expect.poll(async () => page.evaluate(() => {
      const state = window as unknown as { __widgetPostedPrompts?: string[] };
      return state.__widgetPostedPrompts || [];
    }), { timeout: 10_000 }).toEqual(['show widget', 'refine the chart']);
  });

  test('keeps prefix text visible while show-widget fence is incomplete in streaming', async ({ page }) => {
    const sessionId = 'e2e-widget-incomplete';
    const incompleteChunk = 'Progress update\n```show-widget\n{"title":"live","widget_code":"<svg><rect';

    await mockConversationPage(page, sessionId);
    await page.addInitScript(({ scriptedTurns }) => {
      (window as unknown as { __widgetTurnQueue?: MockStreamTurn[] }).__widgetTurnQueue = scriptedTurns;
    }, { scriptedTurns: [{ chunks: [incompleteChunk], keepOpen: true, chunkDelayMs: 50 }] });
    await goToConversation(page, sessionId);
    await sendMessage(page, 'render incomplete widget');

    await expect(page.locator('.is-assistant').filter({ hasText: 'Progress update' }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-widget-container="true"]')).toHaveCount(0);
    // Incomplete widget (open fence, no closing ```) should not be treated as malformed.
    await expect(page.locator('[data-widget-invalid="true"]')).toHaveCount(0);
  });

  test('uses stable widget key across turns with same title/order', async ({ page }) => {
    const sessionId = 'e2e-widget-stable-key';
    const replyA = [
      'Turn A',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg width=\\"200\\" height=\\"80\\"><rect width=\\"200\\" height=\\"80\\" fill=\\"#16213a\\"/></svg>"}',
      '```',
    ].join('\n');
    const replyB = [
      'Turn B',
      '```show-widget',
      '{"title":"sales","widget_code":"<svg width=\\"200\\" height=\\"80\\"><rect width=\\"200\\" height=\\"80\\" fill=\\"#2f3f66\\"/></svg>"}',
      '```',
    ].join('\n');

    await mockConversationPage(page, sessionId);
    await page.unroute(`**/api/chat/sessions/${sessionId}/messages?**`);
    let messagesRequestCount = 0;
    await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
      messagesRequestCount += 1;
      const messages = messagesRequestCount === 1
        ? []
        : messagesRequestCount === 2
          ? [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: 'first widget',
                created_at: '2026-03-22T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: replyA,
                created_at: '2026-03-22T10:00:01.000Z',
                token_usage: null,
              },
            ]
          : [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: 'first widget',
                created_at: '2026-03-22T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: replyA,
                created_at: '2026-03-22T10:00:01.000Z',
                token_usage: null,
              },
              {
                id: 'msg-user-2',
                session_id: sessionId,
                role: 'user',
                content: 'second widget',
                created_at: '2026-03-22T10:00:02.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-2',
                session_id: sessionId,
                role: 'assistant',
                content: replyB,
                created_at: '2026-03-22T10:00:03.000Z',
                token_usage: null,
              },
            ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages,
          hasMore: false,
        }),
      });
    });
    await page.addInitScript(({ scriptedTurns }) => {
      (window as unknown as { __widgetTurnQueue?: MockStreamTurn[] }).__widgetTurnQueue = scriptedTurns;
    }, { scriptedTurns: [{ chunks: [replyA], keepOpen: false }, { chunks: [replyB], keepOpen: false }] });
    await goToConversation(page, sessionId);

    await sendMessage(page, 'first widget');
    await expect(page.locator('[data-widget-container="true"]').first()).toBeVisible({ timeout: 10_000 });
    const firstHeight = await page.locator('[data-widget-iframe="true"]').first().evaluate((node) =>
      (node as HTMLIFrameElement).style.height || '',
    );
    expect(firstHeight).toBeTruthy();

    await sendMessage(page, 'second widget');
    await expect(page.locator('[data-widget-container="true"]')).toHaveCount(2, { timeout: 10_000 });

    const keys = await page.locator('[data-widget-container="true"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-widget-key') || ''),
    );
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);

    const heights = await page.locator('[data-widget-iframe="true"]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLIFrameElement).style.height || ''),
    );
    expect(heights[0]).toBeTruthy();
    expect(heights[1]).toBe(heights[0]);
  });
});
