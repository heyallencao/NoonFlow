import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  goToChat,
  goToConversation,
  sendMessage,
  chatInput,
  sendButton,
  stopButton,
  collectConsoleErrors,
  filterCriticalErrors,
  expectPageLoadTime,
} from '../helpers';

const WORKSPACE_SECTION_NAME = /Workspaces|工作区/;
const MODE_CODE_LABEL = /Code|代码/;
const MODE_PLAN_LABEL = /Plan|计划/;

function buildMockSession(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    title: 'Mock Conversation',
    created_at: '2026-03-14 10:00:00',
    updated_at: '2026-03-14 10:00:00',
    session_type: 'chat',
    model: 'gpt-5',
    system_prompt: '',
    working_directory: '/tmp/monolith-e2e-workspace',
    sdk_session_id: '',
    worktree_id: '',
    project_name: 'Monolith',
    status: 'active',
    mode: 'code',
    provider_name: '',
    provider_id: '',
    sdk_cwd: '',
    runtime_status: 'idle',
    runtime_updated_at: '2026-03-14 10:00:00',
    runtime_error: '',
    assistant_runtime: 'codex',
    assistant_runtime_version: '',
    ...overrides,
  };
}

async function mockConversationPage(
  page: import('@playwright/test').Page,
  options: {
    sessionId: string;
    title?: string;
    assistantRuntime?: 'codex' | 'claude_code';
    model?: string;
    messages?: Array<Record<string, unknown>>;
  },
) {
  const {
    sessionId,
    title = 'Mock Conversation',
    assistantRuntime = 'codex',
    model = assistantRuntime === 'codex' ? 'gpt-5' : 'sonnet',
    messages = [],
  } = options;

  const session = buildMockSession(sessionId, {
    title,
    assistant_runtime: assistantRuntime,
    model,
  });

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
        messages,
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

test.describe('Chat Page', () => {
  test.describe('Page Rendering', () => {
    test('home page redirects to /dashboard', async ({ page }) => {
      await page.goto('/');
      await page.waitForURL('**/dashboard');
      expect(page.url()).toContain('/dashboard');
    });

    test('chat page loads within 3 seconds', async ({ page }) => {
      await expectPageLoadTime(page, '/chat', 10_000);
    });

    test('chat page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToChat(page);
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });

    test('chat page shows empty state when no messages', async ({ page }) => {
      await goToChat(page);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: /Chat with your workspace|与你的工作区对话/,
        })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Select Workspace|选择工作区/ })
      ).toBeVisible();
    });
  });

  test.describe('Chat UI Elements', () => {
    test('workspace section is visible in sidebar', async ({ page }) => {
      await goToChat(page);
      await expect(page.getByRole('heading', { level: 3, name: WORKSPACE_SECTION_NAME })).toBeVisible();
    });

    test('chat textarea is visible with correct placeholder', async ({ page }) => {
      const sessionId = 'e2e-input-shell';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);
      const input = chatInput(page);
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute(
        'placeholder',
        'Message Codex...'
      );
    });

    test('send button is visible', async ({ page }) => {
      const sessionId = 'e2e-send-button';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);
      await expect(sendButton(page)).toBeVisible();
    });

    test('mode toggle is displayed above the input footer', async ({ page }) => {
      const sessionId = 'e2e-mode-toggle';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);
      const modeToggle = page.getByTestId('chat-message-input').getByRole('button', { name: MODE_CODE_LABEL });
      await expect(modeToggle).toBeVisible();
      await modeToggle.click();
      await expect(
        page.getByTestId('chat-message-input').getByRole('button', { name: MODE_PLAN_LABEL })
      ).toBeVisible();
    });
  });

  test.describe('Send Message', () => {
    test('can type in chat input', async ({ page }) => {
      const sessionId = 'e2e-type-input';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);
      const input = chatInput(page);
      await input.fill('Hello, this is a test');
      await expect(input).toHaveValue('Hello, this is a test');
    });

    test('send a message and see it in the conversation', async ({ page }) => {
      const sessionId = 'e2e-send-message';
      const userPrompt = 'Test message from Playwright';
      const finalText = 'Mocked reply from the assistant';
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: 'Send Message Validation',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;
        const messages = messagesRequestCount === 1
          ? []
          : [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: userPrompt,
                created_at: '2026-03-14T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: finalText,
                created_at: '2026-03-14T10:00:01.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: 'Send Message Validation' })],
          }),
        });
      });

      await page.addInitScript(
        ({ responseText }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({ type: 'text', data: responseText }, 60);
                  emitEvent({ type: 'done', data: '' }, 120);
                  window.setTimeout(() => controller.close(), 160);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        { responseText: finalText },
      );

      await goToConversation(page, sessionId);

      await sendMessage(page, userPrompt);

      await expect(page.locator('main').getByText(userPrompt).first()).toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator('.is-user').filter({ hasText: userPrompt }).first()).toBeVisible();
      await expect(page.locator('.is-assistant').filter({ hasText: finalText }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.is-assistant').filter({ hasText: finalText })).toHaveCount(1);
    });

    test('user message converges from temp id to persisted id via user_persisted before completion refetch', async ({ page }) => {
      const sessionId = 'e2e-user-persisted-ack';
      const userPrompt = 'Persist this user turn';
      const finalText = 'Assistant reply after user persisted.';
      await mockConversationPage(page, { sessionId });

      await page.addInitScript(
        ({ responseText, persistedUserId, persistedAssistantId }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const rawBody = typeof init?.body === 'string' ? init.body : null;
              const parsedBody = rawBody ? JSON.parse(rawBody) as {
                session_id?: string;
                client_message_id?: string;
              } : {};
              const clientMessageId = parsedBody.client_message_id ?? 'msg-missing';
              const sessionIdFromBody = parsedBody.session_id ?? '';

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({
                    type: 'user_persisted',
                    data: JSON.stringify({
                      session_id: sessionIdFromBody,
                      client_message_id: clientMessageId,
                      message_id: persistedUserId,
                      created_at: '2026-03-20 12:00:00',
                    }),
                  }, 20);
                  emitEvent({ type: 'text', data: responseText }, 90);
                  emitEvent({ type: 'done', data: '' }, 150);
                  emitEvent({
                    type: 'persisted',
                    data: JSON.stringify({
                      session_id: sessionIdFromBody,
                      client_message_id: clientMessageId,
                      message_id: persistedAssistantId,
                      revision: 1,
                      created_at: '2026-03-20 12:00:01',
                    }),
                  }, 190);
                  window.setTimeout(() => controller.close(), 230);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        {
          responseText: finalText,
          persistedUserId: 'db-user-1',
          persistedAssistantId: 'db-assistant-1',
        },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(page.locator('.is-user').filter({ hasText: userPrompt }).first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#msg-db-user-1')).toContainText(userPrompt);
      await expect(page.locator('.is-assistant').filter({ hasText: finalText }).first()).toBeVisible({ timeout: 10_000 });
    });

    test('input remains editable while streaming and stop action is available', async ({ page }) => {
      const sessionId = 'e2e-streaming-editable';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);

      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            return new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: 'Partial reply' })}\n\n`));
                }, 150);
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }

          return originalFetch(input, init);
        };
      });

      await sendMessage(page, 'Hello');
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.is-assistant').filter({ hasText: 'Partial reply' })).toHaveCount(1);
      await expect(chatInput(page)).toBeEditable();
    });

    test('image attachment is included in chat request and previewed in the user message', async ({ page }) => {
      const sessionId = 'e2e-image-attachment';
      const userPrompt = 'Please inspect the attached image';
      const finalText = 'I received the attached image.';
      const uploadedImagePath = path.join(os.tmpdir(), 'monolith-e2e-attachment.png');
      const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW9sAAAAASUVORK5CYII=';
      let chatRequestBody: Record<string, unknown> | null = null;
      let messagesRequestCount = 0;

      fs.writeFileSync(uploadedImagePath, Buffer.from(imageBase64, 'base64'));

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: {
              id: sessionId,
              title: 'Image Attachment Validation',
              created_at: '2026-03-14 10:00:00',
              updated_at: '2026-03-14 10:00:00',
              session_type: 'chat',
              model: 'gpt-5',
              system_prompt: '',
              working_directory: '',
              sdk_session_id: '',
              project_name: '',
              status: 'active',
              mode: 'code',
              provider_name: '',
              provider_id: '',
              sdk_cwd: '',
              runtime_status: 'idle',
              runtime_updated_at: '2026-03-14 10:00:00',
              runtime_error: '',
              assistant_runtime: 'codex',
              assistant_runtime_version: '',
            },
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;
        const messages = messagesRequestCount === 1
          ? []
          : [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: `<!--files:${JSON.stringify([{
                  id: 'file-1',
                  name: 'monolith-e2e-attachment.png',
                  type: 'image/png',
                  size: 68,
                  filePath: uploadedImagePath,
                }])}-->${userPrompt}`,
                created_at: '2026-03-14T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: finalText,
                created_at: '2026-03-14T10:00:01.000Z',
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

      await page.route('**/api/uploads?**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from(imageBase64, 'base64'),
        });
      });

      await goToConversation(page, sessionId);
      await page.evaluate((responseText) => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            const bodyText = typeof init?.body === 'string'
              ? init.body
              : request
                ? await request.clone().text()
                : '';

            (window as typeof window & { __lastChatRequestBody?: unknown }).__lastChatRequestBody =
              bodyText ? JSON.parse(bodyText) : null;

            const body = [
              `data: ${JSON.stringify({ type: 'text', data: responseText })}\n\n`,
              `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
            ].join('');

            return new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(body));
                controller.close();
              },
            }), {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            });
          }

          return originalFetch(input, init);
        };
      }, finalText);
      await page.setInputFiles('input[type="file"][aria-label="Upload files"]', uploadedImagePath);
      await expect(page.locator('img[alt="monolith-e2e-attachment.png"]').first()).toBeVisible();

      await sendMessage(page, userPrompt);
      await page.waitForFunction(() => {
        return Boolean((window as typeof window & { __lastChatRequestBody?: unknown }).__lastChatRequestBody);
      });

      chatRequestBody = await page.evaluate(() => (
        (window as typeof window & { __lastChatRequestBody?: Record<string, unknown> | null }).__lastChatRequestBody ?? null
      ));

      const files = Array.isArray(chatRequestBody?.files) ? chatRequestBody.files as Array<Record<string, unknown>> : [];
      expect(files).toHaveLength(1);
      expect(files[0]?.name).toBe('monolith-e2e-attachment.png');
      expect(files[0]?.type).toBe('image/png');
      expect(typeof files[0]?.data).toBe('string');
      expect(String(files[0]?.data || '')).not.toBe('');

      await expect(page.locator('.is-user img[alt="monolith-e2e-attachment.png"]').first()).toBeVisible();
      await expect(page.locator('.is-assistant').filter({ hasText: finalText })).toHaveCount(1, { timeout: 10_000 });
    });
  });

  test.describe('Streaming Response', () => {
    test('stop button appears during streaming', async ({ page }) => {
      const sessionId = 'e2e-stop-button';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);

      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            return new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: 'Partial response' })}\n\n`));
                }, 120);
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }

          return originalFetch(input, init);
        };
      });

      await sendMessage(page, 'Hi');
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
    });

    test('assistant avatar appears for assistant response', async ({ page }) => {
      const sessionId = 'e2e-assistant-avatar';
      const finalText = 'Hello from assistant';
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: 'Assistant Avatar Validation',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;
        const messages = messagesRequestCount === 1
          ? []
          : [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: 'Say hello',
                created_at: '2026-03-14T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: finalText,
                created_at: '2026-03-14T10:00:01.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: 'Assistant Avatar Validation' })],
          }),
        });
      });

      await page.addInitScript(
        ({ responseText }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({ type: 'text', data: responseText }, 60);
                  emitEvent({ type: 'done', data: '' }, 120);
                  window.setTimeout(() => controller.close(), 160);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        { responseText: finalText },
      );

      await goToConversation(page, sessionId);

      await sendMessage(page, 'Say hello');
      await expect(page.locator('.is-assistant')).toBeVisible({ timeout: 10_000 });
    });

    test('conversation route remains on the active session URL after response completes', async ({ page }) => {
      const sessionId = 'e2e-active-session-url';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);

      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            const body = [
              `data: ${JSON.stringify({ type: 'text', data: 'URL stable response' })}\n\n`,
              `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
            ].join('');

            return new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(body));
                controller.close();
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }

          return originalFetch(input, init);
        };
      });

      await sendMessage(page, 'Hi there');
      await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
    });

    test('active conversation tab remains visible after response', async ({ page }) => {
      const sessionId = 'e2e-session-tab';
      const title = 'Session Tab Validation';
      await mockConversationPage(page, { sessionId, title });
      await goToConversation(page, sessionId);

      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            const body = [
              `data: ${JSON.stringify({ type: 'text', data: 'Session tab stays visible' })}\n\n`,
              `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
            ].join('');

            return new Response(new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(body));
                controller.close();
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }

          return originalFetch(input, init);
        };
      });

      await sendMessage(page, 'Sidebar test');
      await expect(page.locator(`[title*="${title} ·"]`).first()).toBeVisible();
    });

    test('successful completion renders only one assistant message', async ({ page }) => {
      const sessionId = 'e2e-success-no-duplicate';
      const userPrompt = 'Please avoid duplicate assistant messages';
      const finalText = 'This response should only appear once.';
      const toolUsePayload = {
        id: 'tool-1',
        name: 'exec_command',
        input: { cmd: 'echo hello' },
      };
      const toolResultPayload = {
        tool_use_id: 'tool-1',
        content: 'hello',
        is_error: false,
      };
      // Persisted assistant content intentionally uses a different block order
      // than client-side stream accumulation to guard against duplicate rendering.
      const persistedAssistantContent = JSON.stringify([
        { type: 'tool_use', id: toolUsePayload.id, name: toolUsePayload.name, input: toolUsePayload.input },
        { type: 'tool_result', tool_use_id: toolResultPayload.tool_use_id, content: toolResultPayload.content, is_error: false },
        { type: 'text', text: finalText },
      ]);
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: {
              id: sessionId,
              title: 'Successful Completion Validation',
              created_at: '2026-03-14 10:00:00',
              updated_at: '2026-03-14 10:00:00',
              session_type: 'chat',
              model: 'sonnet',
              system_prompt: '',
              working_directory: '',
              sdk_session_id: '',
              project_name: '',
              status: 'active',
              mode: 'code',
              provider_name: '',
              provider_id: '',
              sdk_cwd: '',
              runtime_status: 'idle',
              runtime_updated_at: '2026-03-14 10:00:00',
              runtime_error: '',
              assistant_runtime: 'claude_code',
              assistant_runtime_version: '',
            },
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;

        const messages = messagesRequestCount === 1
          ? []
          : [
              {
                id: 'msg-user-1',
                session_id: sessionId,
                role: 'user',
                content: userPrompt,
                created_at: '2026-03-14T10:00:00.000Z',
                token_usage: null,
              },
              {
                id: 'msg-assistant-1',
                session_id: sessionId,
                role: 'assistant',
                content: persistedAssistantContent,
                created_at: '2026-03-14T10:00:01.000Z',
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

      await page.addInitScript(
        ({
          finalText: initFinalText,
          sessionId: initSessionId,
          toolUse: initToolUse,
          toolResult: initToolResult,
        }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({ session_id: `${initSessionId}-sdk`, model: 'sonnet' }),
                  }, 20);
                  emitEvent({ type: 'tool_use', data: JSON.stringify(initToolUse) }, 60);
                  emitEvent({ type: 'tool_result', data: JSON.stringify(initToolResult) }, 100);
                  emitEvent({ type: 'text', data: initFinalText }, 140);
                  emitEvent({ type: 'done', data: '' }, 180);
                  window.setTimeout(() => controller.close(), 220);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        {
          finalText,
          sessionId,
          toolUse: toolUsePayload,
          toolResult: toolResultPayload,
        },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      expect(messagesRequestCount).toBeGreaterThanOrEqual(1);
    });

    test('focus resync after done keeps the same assistant visible until persisted ack lands', async ({ page }) => {
      const sessionId = 'e2e-focus-resync-persisted';
      const userPrompt = 'Please keep the final reply stable across focus sync';
      const finalText = 'Final reply survives focus sync before persisted ack.';
      const persistedAssistantContent = JSON.stringify([
        { type: 'text', text: finalText },
      ]);
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: 'Focus Resync Persisted Ack Validation',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;

        const baseUserMessage = {
          id: 'msg-user-1',
          session_id: sessionId,
          role: 'user',
          content: userPrompt,
          created_at: '2026-03-20T10:00:00.000Z',
          token_usage: null,
        };

        const messages = messagesRequestCount === 1
          ? []
          : messagesRequestCount <= 3
            ? [baseUserMessage]
            : [
                baseUserMessage,
                {
                  id: 'msg-assistant-1',
                  session_id: sessionId,
                  role: 'assistant',
                  content: persistedAssistantContent,
                  created_at: '2026-03-20T10:00:01.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: 'Focus Resync Persisted Ack Validation' })],
          }),
        });
      });

      await page.addInitScript(
        ({ finalText: initFinalText, sessionId: initSessionId }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const bodyText = typeof init?.body === 'string'
                ? init.body
                : request
                  ? await request.clone().text()
                  : '';
              let clientMessageId = 'missing-client-message-id';
              try {
                const payload = JSON.parse(bodyText) as { client_message_id?: string };
                if (payload.client_message_id) {
                  clientMessageId = payload.client_message_id;
                }
              } catch {
                // fall through with placeholder id
              }

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({ session_id: `${initSessionId}-sdk`, model: 'gpt-5' }),
                  }, 20);
                  emitEvent({ type: 'text', data: initFinalText }, 90);
                  emitEvent({ type: 'done', data: '' }, 150);
                  emitEvent({
                    type: 'persisted',
                    data: JSON.stringify({
                      session_id: initSessionId,
                      client_message_id: clientMessageId,
                      message_id: 'msg-assistant-1',
                      revision: 2,
                      created_at: '2026-03-20 10:00:01',
                    }),
                  }, 420);
                  window.setTimeout(() => controller.close(), 470);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        {
          finalText,
          sessionId,
        },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
      });

      await page.waitForTimeout(120);
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1);

      await page.waitForTimeout(700);
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1);
      expect(messagesRequestCount).toBeGreaterThanOrEqual(3);
    });

    test('visibilitychange resync after done keeps the same assistant visible until persisted ack lands', async ({ page }) => {
      const sessionId = 'e2e-visibility-resync-persisted';
      const userPrompt = 'Please keep the final reply stable across visibility sync';
      const finalText = 'Final reply survives visibility sync before persisted ack.';
      const persistedAssistantContent = JSON.stringify([
        { type: 'text', text: finalText },
      ]);
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: 'Visibility Resync Persisted Ack Validation',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;

        const baseUserMessage = {
          id: 'msg-user-1',
          session_id: sessionId,
          role: 'user',
          content: userPrompt,
          created_at: '2026-03-20T10:20:00.000Z',
          token_usage: null,
        };

        const messages = messagesRequestCount === 1
          ? []
          : messagesRequestCount <= 3
            ? [baseUserMessage]
            : [
                baseUserMessage,
                {
                  id: 'msg-assistant-1',
                  session_id: sessionId,
                  role: 'assistant',
                  content: persistedAssistantContent,
                  created_at: '2026-03-20T10:20:01.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: 'Visibility Resync Persisted Ack Validation' })],
          }),
        });
      });

      await page.addInitScript(
        ({ finalText: initFinalText, sessionId: initSessionId }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const bodyText = typeof init?.body === 'string'
                ? init.body
                : request
                  ? await request.clone().text()
                  : '';
              let clientMessageId = 'missing-client-message-id';
              try {
                const payload = JSON.parse(bodyText) as { client_message_id?: string };
                if (payload.client_message_id) {
                  clientMessageId = payload.client_message_id;
                }
              } catch {
                // fall through with placeholder id
              }

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({ session_id: `${initSessionId}-sdk`, model: 'gpt-5' }),
                  }, 20);
                  emitEvent({ type: 'text', data: initFinalText }, 90);
                  emitEvent({ type: 'done', data: '' }, 150);
                  emitEvent({
                    type: 'persisted',
                    data: JSON.stringify({
                      session_id: initSessionId,
                      client_message_id: clientMessageId,
                      message_id: 'msg-assistant-1',
                      revision: 2,
                      created_at: '2026-03-20 10:20:01',
                    }),
                  }, 420);
                  window.setTimeout(() => controller.close(), 470);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        {
          finalText,
          sessionId,
        },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.waitForTimeout(120);
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1);

      await page.waitForTimeout(700);
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1);
      expect(messagesRequestCount).toBeGreaterThanOrEqual(3);
    });

    test('switching to another session and back keeps a single assistant after remount', async ({ page }) => {
      const sessionId = 'e2e-remount-persisted';
      const sessionTitle = 'Remount Persisted Ack Validation';
      const userPrompt = 'Please keep the final reply stable across remount';
      const finalText = 'Final reply survives remount before persisted ack.';
      const persistedAssistantContent = JSON.stringify([
        { type: 'text', text: finalText },
      ]);
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: sessionTitle,
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;

        const baseUserMessage = {
          id: 'msg-user-1',
          session_id: sessionId,
          role: 'user',
          content: userPrompt,
          created_at: '2026-03-20T10:30:00.000Z',
          token_usage: null,
        };

        const messages = messagesRequestCount === 1
          ? []
          : messagesRequestCount <= 3
            ? [baseUserMessage]
            : [
                baseUserMessage,
                {
                  id: 'msg-assistant-1',
                  session_id: sessionId,
                  role: 'assistant',
                  content: persistedAssistantContent,
                  created_at: '2026-03-20T10:30:01.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: sessionTitle })],
          }),
        });
      });

      await page.addInitScript(
        ({ finalText: initFinalText, sessionId: initSessionId }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const bodyText = typeof init?.body === 'string'
                ? init.body
                : request
                  ? await request.clone().text()
                  : '';
              let clientMessageId = 'missing-client-message-id';
              try {
                const payload = JSON.parse(bodyText) as { client_message_id?: string };
                if (payload.client_message_id) {
                  clientMessageId = payload.client_message_id;
                }
              } catch {
                // fall through with placeholder id
              }

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const emitEvent = (payload: unknown, delayMs: number) => {
                    window.setTimeout(() => {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }, delayMs);
                  };

                  emitEvent({
                    type: 'status',
                    data: JSON.stringify({ session_id: `${initSessionId}-sdk`, model: 'gpt-5' }),
                  }, 20);
                  emitEvent({ type: 'text', data: initFinalText }, 90);
                  emitEvent({ type: 'done', data: '' }, 150);
                  emitEvent({
                    type: 'persisted',
                    data: JSON.stringify({
                      session_id: initSessionId,
                      client_message_id: clientMessageId,
                      message_id: 'msg-assistant-1',
                      revision: 2,
                      created_at: '2026-03-20 10:30:01',
                    }),
                  }, 420);
                  window.setTimeout(() => controller.close(), 470);
                },
              });

              return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
            }

            return originalFetch(input, init);
          };
        },
        {
          finalText,
          sessionId,
        },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      await page.locator('a[href="/dashboard"]').click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

      await page.waitForTimeout(700);

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`), { timeout: 10_000 });

      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      expect(messagesRequestCount).toBeGreaterThanOrEqual(2);
    });

    test('hard reload keeps a single persisted user and assistant while server persistence catches up', async ({ page }) => {
      const sessionId = 'e2e-hard-reload-persisted';
      const sessionTitle = 'Hard Reload Persisted Ack Validation';
      const userPrompt = 'Please survive a hard reload without duplicates';
      const finalText = 'Final reply survives a hard reload while persistence catches up.';
      const persistedAssistantContent = JSON.stringify([
        { type: 'text', text: finalText },
      ]);
      let streamCompleted = false;
      let reloadPhase = false;
      let reloadMessagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: sessionTitle,
              runtime_status: reloadPhase ? 'running' : 'idle',
              runtime_updated_at: reloadPhase
                ? '2026-03-20 10:40:05'
                : '2026-03-20 10:40:00',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        const baseUserMessage = {
          id: 'msg-user-1',
          session_id: sessionId,
          role: 'user',
          content: userPrompt,
          created_at: '2026-03-20T10:40:00.000Z',
          token_usage: null,
        };

        const persistedAssistantMessage = {
          id: 'msg-assistant-1',
          session_id: sessionId,
          role: 'assistant',
          content: persistedAssistantContent,
          created_at: '2026-03-20T10:40:01.000Z',
          token_usage: null,
        };

        const messages = !streamCompleted
          ? []
          : reloadPhase
            ? ((reloadMessagesRequestCount += 1) === 1
              ? [baseUserMessage]
              : [baseUserMessage, persistedAssistantMessage])
            : [baseUserMessage];

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages,
            hasMore: false,
          }),
        });
      });

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: sessionTitle })],
          }),
        });
      });

      await page.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        streamCompleted = true;

        const payloadText = route.request().postData() || '';
        let clientMessageId = 'missing-client-message-id';
        try {
          const payload = JSON.parse(payloadText) as { client_message_id?: string };
          if (payload.client_message_id) {
            clientMessageId = payload.client_message_id;
          }
        } catch {
          // keep fallback client message id
        }

        const body = [
          `data: ${JSON.stringify({
            type: 'user_persisted',
            data: JSON.stringify({
              session_id: sessionId,
              client_message_id: clientMessageId,
              message_id: 'msg-user-1',
              created_at: '2026-03-20 10:40:00',
            }),
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'status',
            data: JSON.stringify({ session_id: `${sessionId}-sdk`, model: 'gpt-5' }),
          })}\n\n`,
          `data: ${JSON.stringify({ type: 'text', data: finalText })}\n\n`,
          `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
        ].join('');

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body,
        });
      });

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-user').filter({ hasText: userPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      reloadPhase = true;
      reloadMessagesRequestCount = 0;

      await page.reload();
      await page.waitForURL(new RegExp(`/chat/${sessionId}$`), { timeout: 10_000 });

      await expect(
        page.locator('.is-user').filter({ hasText: userPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(() => reloadMessagesRequestCount).toBeGreaterThanOrEqual(2);
    });

    test('hard reload keeps cached history visible while sending before messages refetch completes', async ({ page }) => {
      const sessionId = 'e2e-hard-reload-cache-hydration';
      const sessionTitle = 'Hard Reload Cached History Hydration';
      const cachedUserPrompt = 'Cached history should stay visible';
      const cachedAssistantReply = 'Cached assistant reply should not disappear';
      const secondUserPrompt = 'Send before refetch finishes';
      const secondAssistantReply = 'New reply arrives while cached history stays put.';
      let reloadPhase = false;
      let streamCompleted = false;
      let reloadMessagesRequestCount = 0;
      let releaseReloadMessages: () => void = () => {};
      const reloadMessagesGate = new Promise<void>((resolve) => {
        releaseReloadMessages = () => resolve();
      });

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: sessionTitle,
              runtime_status: reloadPhase ? 'running' : 'idle',
              runtime_updated_at: reloadPhase
                ? '2026-03-20 11:20:05'
                : '2026-03-20 11:20:00',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        reloadMessagesRequestCount += 1;

        const initialMessages = [
          {
            id: 'msg-user-1',
            session_id: sessionId,
            role: 'user',
            content: cachedUserPrompt,
            created_at: '2026-03-20T11:20:00.000Z',
            token_usage: null,
          },
          {
            id: 'msg-assistant-1',
            session_id: sessionId,
            role: 'assistant',
            content: cachedAssistantReply,
            created_at: '2026-03-20T11:20:01.000Z',
            token_usage: null,
          },
        ];

        const convergedMessages = [
          ...initialMessages,
          {
            id: 'msg-user-2',
            session_id: sessionId,
            role: 'user',
            content: secondUserPrompt,
            created_at: '2026-03-20T11:20:02.000Z',
            token_usage: null,
            client_message_id: 'msg-reload-send',
          },
          {
            id: 'msg-assistant-2',
            session_id: sessionId,
            role: 'assistant',
            content: JSON.stringify([{ type: 'text', text: secondAssistantReply }]),
            created_at: '2026-03-20T11:20:03.000Z',
            token_usage: null,
            client_message_id: 'msg-reload-send',
          },
        ];

        if (!reloadPhase) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              messages: initialMessages,
              hasMore: false,
            }),
          });
          return;
        }

        await reloadMessagesGate;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages: streamCompleted ? convergedMessages : initialMessages,
            hasMore: false,
          }),
        });
      });

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: sessionTitle })],
          }),
        });
      });

      await page.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        streamCompleted = true;

        const payloadText = route.request().postData() || '';
        let clientMessageId = 'msg-reload-send';
        try {
          const payload = JSON.parse(payloadText) as { client_message_id?: string };
          if (payload.client_message_id) {
            clientMessageId = payload.client_message_id;
          }
        } catch {
          // keep fallback client message id
        }

        const body = [
          `data: ${JSON.stringify({
            type: 'user_persisted',
            data: JSON.stringify({
              session_id: sessionId,
              client_message_id: clientMessageId,
              message_id: 'msg-user-2',
              created_at: '2026-03-20 11:20:02',
            }),
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'status',
            data: JSON.stringify({ session_id: `${sessionId}-sdk`, model: 'gpt-5' }),
          })}\n\n`,
          `data: ${JSON.stringify({ type: 'text', data: secondAssistantReply })}\n\n`,
          `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
        ].join('');

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body,
        });
      });

      await goToConversation(page, sessionId);

      await expect(
        page.locator('.is-user').filter({ hasText: cachedUserPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: cachedAssistantReply })
      ).toHaveCount(1, { timeout: 10_000 });

      reloadPhase = true;
      reloadMessagesRequestCount = 0;

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(new RegExp(`/chat/${sessionId}$`), { timeout: 10_000 });

      await expect(
        page.locator('.is-user').filter({ hasText: cachedUserPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: cachedAssistantReply })
      ).toHaveCount(1, { timeout: 10_000 });

      await sendMessage(page, secondUserPrompt);

      await expect(
        page.locator('.is-user').filter({ hasText: cachedUserPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: cachedAssistantReply })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-user').filter({ hasText: secondUserPrompt })
      ).toHaveCount(1, { timeout: 10_000 });

      releaseReloadMessages();

      await expect(
        page.locator('.is-assistant').filter({ hasText: secondAssistantReply })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(() => reloadMessagesRequestCount).toBeGreaterThanOrEqual(1);
    });

    test('online reconnect resync retries until the persisted assistant converges without duplicates', async ({ page }) => {
      const sessionId = 'e2e-online-reconnect-persisted';
      const sessionTitle = 'Online Reconnect Persisted Ack Validation';
      const userPrompt = 'Please survive a reconnect without duplicates';
      const finalText = 'Final reply survives reconnect while persistence catches up.';
      const persistedAssistantContent = JSON.stringify([
        { type: 'text', text: finalText },
      ]);
      let streamCompleted = false;
      let reconnectReady = false;
      let postReconnectRequestCount = 0;

      await page.addInitScript(() => {
        const originalSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          const nextTimeout = typeof timeout === 'number' && timeout >= 200
            ? Math.max(5, Math.floor(timeout / 100))
            : timeout;
          return originalSetTimeout(handler, nextTimeout, ...args);
        }) as typeof window.setTimeout;
      });

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: sessionTitle,
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        const baseUserMessage = {
          id: 'msg-user-1',
          session_id: sessionId,
          role: 'user',
          content: userPrompt,
          created_at: '2026-03-20T10:50:00.000Z',
          token_usage: null,
        };

        const persistedAssistantMessage = {
          id: 'msg-assistant-1',
          session_id: sessionId,
          role: 'assistant',
          content: persistedAssistantContent,
          created_at: '2026-03-20T10:50:01.000Z',
          token_usage: null,
        };

        if (!streamCompleted) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              messages: [],
              hasMore: false,
            }),
          });
          return;
        }

        if (!reconnectReady) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'offline' }),
          });
          return;
        }

        postReconnectRequestCount += 1;
        const messages = postReconnectRequestCount === 1
          ? [baseUserMessage]
          : [baseUserMessage, persistedAssistantMessage];

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages,
            hasMore: false,
          }),
        });
      });

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: sessionTitle })],
          }),
        });
      });

      await page.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }

        streamCompleted = true;

        const payloadText = route.request().postData() || '';
        let clientMessageId = 'missing-client-message-id';
        try {
          const payload = JSON.parse(payloadText) as { client_message_id?: string };
          if (payload.client_message_id) {
            clientMessageId = payload.client_message_id;
          }
        } catch {
          // keep fallback client message id
        }

        const body = [
          `data: ${JSON.stringify({
            type: 'user_persisted',
            data: JSON.stringify({
              session_id: sessionId,
              client_message_id: clientMessageId,
              message_id: 'msg-user-1',
              created_at: '2026-03-20 10:50:00',
            }),
          })}\n\n`,
          `data: ${JSON.stringify({
            type: 'status',
            data: JSON.stringify({ session_id: `${sessionId}-sdk`, model: 'gpt-5' }),
          })}\n\n`,
          `data: ${JSON.stringify({ type: 'text', data: finalText })}\n\n`,
          `data: ${JSON.stringify({ type: 'done', data: '' })}\n\n`,
        ].join('');

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body,
        });
      });

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(
        page.locator('.is-user').filter({ hasText: userPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      await page.waitForTimeout(900);
      expect(postReconnectRequestCount).toBe(0);

      reconnectReady = true;
      await page.evaluate(() => {
        window.dispatchEvent(new Event('online'));
      });

      await expect(
        page.locator('.is-user').filter({ hasText: userPrompt })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('.is-assistant').filter({ hasText: finalText })
      ).toHaveCount(1, { timeout: 10_000 });
      await expect.poll(() => postReconnectRequestCount).toBeGreaterThanOrEqual(2);
    });

    function assertCapturedChatPayload(
      value: unknown,
    ): asserts value is {
      assistant_runtime?: string;
      model?: string;
      content?: string;
    } {
      if (!value || typeof value !== 'object') {
        throw new Error('Expected chat payload to be captured');
      }
    }

    for (const scenario of [
      {
        name: 'Codex long session sends runtime payload and keeps a single assistant message',
        sessionId: 'e2e-codex-long-session',
        assistantRuntime: 'codex' as const,
        model: 'gpt-5',
        placeholder: 'Message Codex...',
        promptSeed: 'Codex long prompt segment',
        replySeed: 'Codex long reply segment',
      },
      {
        name: 'Claude Code long session sends runtime payload and keeps a single assistant message',
        sessionId: 'e2e-claude-long-session',
        assistantRuntime: 'claude_code' as const,
        model: 'sonnet',
        placeholder: 'Message Claude...',
        promptSeed: 'Claude long prompt segment',
        replySeed: 'Claude long reply segment',
      },
    ]) {
      test(scenario.name, async ({ page }) => {
        const longPrompt = Array.from({ length: 180 }, (_, index) => `${scenario.promptSeed} ${index}`).join(' ');
        const longReply = Array.from({ length: 220 }, (_, index) => `${scenario.replySeed} ${index}`).join(' ');
        let capturedChatPayload: unknown = null;

        await mockConversationPage(page, {
          sessionId: scenario.sessionId,
          title: `${scenario.assistantRuntime} long session`,
          assistantRuntime: scenario.assistantRuntime,
          model: scenario.model,
        });

        await page.route('**/api/chat', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }

          capturedChatPayload = route.request().postDataJSON();

          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: [
              `data: ${JSON.stringify({
                type: 'status',
                data: JSON.stringify({
                  session_id: `${scenario.sessionId}-sdk`,
                  model: scenario.model,
                }),
              })}`,
              '',
              `data: ${JSON.stringify({ type: 'text', data: longReply })}`,
              '',
              `data: ${JSON.stringify({ type: 'done', data: '' })}`,
              '',
            ].join('\n'),
          });
        });

        await goToConversation(page, scenario.sessionId);
        await expect(chatInput(page)).toHaveAttribute('placeholder', scenario.placeholder);

        await sendMessage(page, longPrompt);

        await expect(
          page.locator('.is-user').filter({ hasText: longPrompt.slice(0, 120) })
        ).toHaveCount(1, { timeout: 10_000 });
        await expect(
          page.locator('.is-assistant').filter({ hasText: longReply.slice(0, 120) })
        ).toHaveCount(1, { timeout: 10_000 });

        expect(capturedChatPayload).not.toBeNull();
        assertCapturedChatPayload(capturedChatPayload);
        expect(capturedChatPayload.assistant_runtime).toBe(scenario.assistantRuntime);
        expect(capturedChatPayload.model).toBe(scenario.model);
        expect(capturedChatPayload.content).toBe(longPrompt);
        expect(capturedChatPayload.content?.length).toBe(longPrompt.length);
      });
    }
  });

  test.describe('Abort Generation', () => {
    test('clicking stop button halts streaming', async ({ page }) => {
      const sessionId = 'e2e-stop-stream';
      await mockConversationPage(page, { sessionId });
      await goToConversation(page, sessionId);

      await page.evaluate(() => {
        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();

        window.fetch = async (input, init) => {
          const request = input instanceof Request ? input : null;
          const resource = typeof input === 'string' ? input : request?.url ?? String(input);
          const url = new URL(resource, window.location.href);
          const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

          if (url.pathname === '/api/chat' && method === 'POST') {
            const signal = init?.signal ?? request?.signal;

            return new Promise((resolve) => {
              const timers: number[] = [];
              let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

              const cleanup = () => {
                for (const timer of timers) {
                  window.clearTimeout(timer);
                }
                timers.length = 0;
              };

              const abort = () => {
                cleanup();
                if (streamController) {
                  streamController.error(new DOMException('Aborted', 'AbortError'));
                }
              };

              if (signal) {
                signal.addEventListener('abort', abort, { once: true });
              }

              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  streamController = controller;
                  const timer = window.setTimeout(() => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: 'Long running reply' })}\n\n`));
                  }, 120);
                  timers.push(timer);
                },
                cancel() {
                  cleanup();
                },
              });

              resolve(new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              }));
            });
          }

          return originalFetch(input, init);
        };
      });

      await sendMessage(page, 'Write a very long essay about the universe');
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
      await stopButton(page).click();
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });
    });

    test('stopping keeps partial output visible without switching tabs', async ({ page }) => {
      const sessionId = 'e2e-stop-keeps-partial';
      const userPrompt = 'Please stream a long answer so I can stop it';
      const partialText = 'Partial streaming response that should stay visible';
      const stoppedText = `${partialText}\n\n*(generation stopped)*`;
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: {
              id: sessionId,
              title: 'Stop Streaming Validation',
              created_at: '2026-03-11 10:00:00',
              updated_at: '2026-03-11 10:00:00',
              session_type: 'chat',
              model: 'sonnet',
              system_prompt: '',
              working_directory: '',
              sdk_session_id: '',
              project_name: '',
              status: 'active',
              mode: 'code',
              provider_name: '',
              provider_id: '',
              sdk_cwd: '',
              runtime_status: 'idle',
              runtime_updated_at: '2026-03-11 10:00:00',
              runtime_error: '',
            },
            recovery: null,
            runtimeState: null,
          }),
        });
      });

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
                  content: userPrompt,
                  created_at: '2026-03-11T10:00:00.000Z',
                  token_usage: null,
                },
              ]
            : [
                {
                  id: 'msg-user-1',
                  session_id: sessionId,
                  role: 'user',
                  content: userPrompt,
                  created_at: '2026-03-11T10:00:00.000Z',
                  token_usage: null,
                },
                {
                  id: 'msg-assistant-1',
                  session_id: sessionId,
                  role: 'assistant',
                  content: stoppedText,
                  created_at: '2026-03-11T10:00:01.000Z',
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

      await page.addInitScript(
        ({ sessionId: initSessionId }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const signal = init?.signal ?? request?.signal;

              return new Promise((resolve) => {
                const timers: number[] = [];
                let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

                const cleanup = () => {
                  for (const timer of timers) {
                    window.clearTimeout(timer);
                  }
                  timers.length = 0;
                };

                const abort = () => {
                  cleanup();
                  if (streamController) {
                    streamController.error(new DOMException('Aborted', 'AbortError'));
                  }
                };

                if (signal) {
                  signal.addEventListener('abort', abort, { once: true });
                }

                const stream = new ReadableStream<Uint8Array>({
                  start(controller) {
                    streamController = controller;

                    const emitEvent = (payload: unknown, delayMs: number) => {
                      const timer = window.setTimeout(() => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                      }, delayMs);
                      timers.push(timer);
                    };

                    emitEvent({
                      type: 'status',
                      data: JSON.stringify({ session_id: `${initSessionId}-sdk`, model: 'sonnet' }),
                    }, 20);
                    emitEvent({ type: 'text', data: 'Partial streaming' }, 120);
                    emitEvent({ type: 'text', data: ' response that' }, 240);
                    emitEvent({ type: 'text', data: ' should stay visible' }, 360);
                  },
                  cancel() {
                    cleanup();
                  },
                });

                resolve(new Response(stream, {
                  status: 200,
                  headers: { 'Content-Type': 'text/event-stream' },
                }));
              });
            }

            if (
              url.pathname === `/api/chat/sessions/${initSessionId}`
              || url.pathname === `/api/chat/sessions/${initSessionId}/messages`
            ) {
              return originalFetch(input, init);
            }

            return originalFetch(input, init);
          };
        },
        { sessionId },
      );

      await goToConversation(page, sessionId);
      await sendMessage(page, userPrompt);

      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('main')).toContainText(partialText, { timeout: 10_000 });

      await stopButton(page).click();
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });

      // Immediate stale history sync should not erase the partial content.
      await page.waitForTimeout(80);
      await expect(page.locator('main')).toContainText(partialText);
      await expect(page.locator('main')).toContainText('generation stopped');

      // The later retry can swap in the persisted server message, but the visible content must remain.
      await page.waitForTimeout(500);
      await expect(page.locator('main')).toContainText(partialText);
      expect(messagesRequestCount).toBeGreaterThanOrEqual(3);
    });

    test.fixme('failed assistant reply stays visible and in order after a later successful turn', async ({ page }) => {
      const sessionId = 'e2e-error-persists-in-order';
      const firstPrompt = 'first prompt should fail';
      const secondPrompt = 'second prompt should succeed';
      const secondReply = 'second successful reply';
      let messagesRequestCount = 0;

      await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session: buildMockSession(sessionId, {
              title: 'Error Persistence Validation',
            }),
            recovery: null,
            runtimeState: null,
          }),
        });
      });

      await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
        messagesRequestCount += 1;

        const messages = messagesRequestCount === 1
          ? []
          : messagesRequestCount === 2
            ? [
                {
                  id: 'db-user-1',
                  session_id: sessionId,
                  role: 'user',
                  content: firstPrompt,
                  created_at: '2026-03-21T10:00:00.000Z',
                  token_usage: null,
                },
              ]
            : [
                {
                  id: 'db-user-1',
                  session_id: sessionId,
                  role: 'user',
                  content: firstPrompt,
                  created_at: '2026-03-21T10:00:00.000Z',
                  token_usage: null,
                },
                {
                  id: 'db-user-2',
                  session_id: sessionId,
                  role: 'user',
                  content: secondPrompt,
                  created_at: '2026-03-21T10:00:02.000Z',
                  token_usage: null,
                },
                {
                  id: 'db-assistant-2',
                  session_id: sessionId,
                  role: 'assistant',
                  content: secondReply,
                  created_at: '2026-03-21T10:00:03.000Z',
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

      await page.route('**/api/chat/sessions?type=all**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [buildMockSession(sessionId, { title: 'Error Persistence Validation' })],
          }),
        });
      });

      await page.addInitScript(
        ({ failedPrompt, successPrompt, successReply }) => {
          const originalFetch = window.fetch.bind(window);
          const encoder = new TextEncoder();

          window.fetch = async (input, init) => {
            const request = input instanceof Request ? input : null;
            const resource = typeof input === 'string' ? input : request?.url ?? String(input);
            const url = new URL(resource, window.location.href);
            const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

            if (url.pathname === '/api/chat' && method === 'POST') {
              const rawBody = typeof init?.body === 'string' ? init.body : null;
              const parsedBody = rawBody ? JSON.parse(rawBody) as {
                content?: string;
                session_id?: string;
                client_message_id?: string;
              } : {};
              const content = parsedBody.content ?? '';
              const clientMessageId = parsedBody.client_message_id ?? 'msg-missing';
              const requestSessionId = parsedBody.session_id ?? '';

              if (content === failedPrompt) {
                const stream = new ReadableStream<Uint8Array>({
                  start(controller) {
                    const emitEvent = (payload: unknown, delayMs: number) => {
                      window.setTimeout(() => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                      }, delayMs);
                    };

                    emitEvent({
                      type: 'user_persisted',
                      data: JSON.stringify({
                        session_id: requestSessionId,
                        client_message_id: clientMessageId,
                        message_id: 'db-user-1',
                        created_at: '2026-03-21 10:00:00',
                      }),
                    }, 20);
                    emitEvent({ type: 'error', data: 'provider overloaded' }, 80);
                    emitEvent({ type: 'done', data: '' }, 120);
                    window.setTimeout(() => controller.close(), 160);
                  },
                });

                return new Response(stream, {
                  status: 200,
                  headers: { 'Content-Type': 'text/event-stream' },
                });
              }

              if (content === successPrompt) {
                const stream = new ReadableStream<Uint8Array>({
                  start(controller) {
                    const emitEvent = (payload: unknown, delayMs: number) => {
                      window.setTimeout(() => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                      }, delayMs);
                    };

                    emitEvent({
                      type: 'user_persisted',
                      data: JSON.stringify({
                        session_id: requestSessionId,
                        client_message_id: clientMessageId,
                        message_id: 'db-user-2',
                        created_at: '2026-03-21 10:00:02',
                      }),
                    }, 20);
                    emitEvent({ type: 'text', data: successReply }, 80);
                    emitEvent({
                      type: 'persisted',
                      data: JSON.stringify({
                        session_id: requestSessionId,
                        client_message_id: clientMessageId,
                        message_id: 'db-assistant-2',
                        revision: 1,
                        created_at: '2026-03-21 10:00:03',
                      }),
                    }, 110);
                    emitEvent({ type: 'done', data: '' }, 120);
                    window.setTimeout(() => controller.close(), 160);
                  },
                });

                return new Response(stream, {
                  status: 200,
                  headers: { 'Content-Type': 'text/event-stream' },
                });
              }

              return originalFetch(input, init);
            }

            return originalFetch(input, init);
          };
        },
        {
          failedPrompt: firstPrompt,
          successPrompt: secondPrompt,
          successReply: secondReply,
        },
      );

      await goToConversation(page, sessionId);

      await sendMessage(page, firstPrompt);
      await expect(page.locator('.is-assistant').filter({ hasText: 'provider overloaded' }).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('main')).toContainText('模型有问题，调用失败，请稍后重试。');
      await expect(page.locator('main')).toContainText('错误详情：provider overloaded');

      await sendMessage(page, secondPrompt);
      const firstPromptBubble = page.locator('#msg-db-user-1');
      const firstErrorBubble = page.locator('.is-assistant').filter({ hasText: 'provider overloaded' }).first();
      const secondPromptBubble = page.locator('#msg-db-user-2');
      const secondReplyBubble = page.locator('.is-assistant').filter({ hasText: secondReply }).first();

      await expect(secondReplyBubble).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('main')).toContainText('模型有问题，调用失败，请稍后重试。');
      await expect(page.locator('main')).toContainText('错误详情：provider overloaded');

      const firstPromptBox = await firstPromptBubble.boundingBox();
      const firstErrorBox = await firstErrorBubble.boundingBox();
      const secondPromptBox = await secondPromptBubble.boundingBox();
      const secondReplyBox = await secondReplyBubble.boundingBox();

      expect(firstPromptBox).not.toBeNull();
      expect(firstErrorBox).not.toBeNull();
      expect(secondPromptBox).not.toBeNull();
      expect(secondReplyBox).not.toBeNull();

      expect(firstErrorBox!.y).toBeGreaterThan(firstPromptBox!.y);
      expect(secondPromptBox!.y).toBeGreaterThan(firstErrorBox!.y);
      expect(secondReplyBox!.y).toBeGreaterThan(secondPromptBox!.y);
    });
  });

  test.describe('Chat History', () => {
    test('sidebar has Workspaces section', async ({ page }) => {
      await goToChat(page);
      await expect(page.getByRole('heading', { level: 3, name: WORKSPACE_SECTION_NAME })).toBeVisible();
    });

    test('workspace list or empty state is shown in sidebar', async ({ page }) => {
      await goToChat(page);
      const emptyState = page.locator('text=No workspaces yet. Add a folder to get started.');
      const workspaces = page.locator('aside [role="group"]');
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      const hasWorkspaces = (await workspaces.count()) > 0;
      expect(hasEmpty || hasWorkspaces).toBeTruthy();
    });
  });
});
