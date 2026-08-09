import { expect, test, type Page } from '@playwright/test';
import { goToConversation, sendMessage, stopButton } from '../helpers';

type StreamScenario = 'terminal' | 'stop';

async function mockChatShell(page: Page, sessionId: string) {
  const session = {
    id: sessionId,
    title: 'Child Activity',
    created_at: '2026-08-09 10:00:00',
    updated_at: '2026-08-09 10:00:00',
    session_type: 'chat',
    model: 'sonnet',
    system_prompt: '',
    working_directory: '/tmp/noonflow-child-activity',
    sdk_session_id: '',
    project_name: 'NoonFlow',
    status: 'active',
    mode: 'code',
    provider_name: '',
    provider_id: '',
    sdk_cwd: '',
    runtime_status: 'idle',
    runtime_updated_at: '2026-08-09 10:00:00',
    runtime_error: '',
    assistant_runtime: 'claude_code',
    assistant_runtime_version: '',
  };

  await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [], hasMore: false }),
    });
  });
  await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session, recovery: null, runtimeState: null }),
    });
  });
  await page.route('**/api/chat/sessions?type=all**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [session] }),
    });
  });
  await page.route('**/api/settings/app', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ settings: { default_assistant_runtime: 'claude_code' } }),
    });
  });
  await page.route('**/api/assistant-runtimes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_assistant_runtime: 'claude_code',
        runtimes: [{
          id: 'claude_code', label: 'Claude Code', enabled: true, available: true,
          installed: true, configured: true, supports_plan_mode: true, supports_permissions: true,
        }],
      }),
    });
  });
  await page.route('**/api/providers/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ groups: [], default_provider_id: '' }),
    });
  });
}

async function installMockSSE(page: Page, sessionId: string, scenario: StreamScenario) {
  await page.addInitScript(({ activeSessionId, activeScenario }) => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();

    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const resource = typeof input === 'string' ? input : request?.url ?? String(input);
      const url = new URL(resource, window.location.href);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      if (url.pathname !== '/api/chat' || method !== 'POST') {
        return originalFetch(input, init);
      }

      const signal = init?.signal ?? request?.signal;
      const timers: number[] = [];
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
      let closed = false;
      const cleanup = () => {
        for (const timer of timers) window.clearTimeout(timer);
        timers.length = 0;
      };
      const abort = () => {
        if (closed) return;
        closed = true;
        cleanup();
        streamController?.error(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          const emit = (event: unknown, delay: number) => {
            timers.push(window.setTimeout(() => {
              if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }, delay));
          };
          const activity = (
            id: string,
            runtime: 'claude_code' | 'codex' | 'pi',
            kind: string,
            title: string,
            status: 'running' | 'completed',
            summary: string,
          ) => ({
            type: 'activity.updated',
            data: JSON.stringify({
              id, runtime, kind, title, status, summary,
              startedAt: Date.now() - 2_000,
              updatedAt: Date.now(),
            }),
          });

          emit({
            type: 'status',
            data: JSON.stringify({ session_id: `${activeSessionId}-native`, model: 'sonnet' }),
          }, 20);
          emit({ type: 'text', data: 'Working across runtimes.' }, 40);

          if (activeScenario === 'terminal') {
            emit({ type: 'tool_use', data: JSON.stringify({ id: 'tool-read', name: 'Read', input: { file_path: '/tmp/demo.ts' } }) }, 60);
            emit({ type: 'tool_result', data: JSON.stringify({ tool_use_id: 'tool-read', content: 'done' }) }, 80);
            emit(activity('claude-task', 'claude_code', 'subagent', 'Claude research', 'running', 'Inspecting SDK events'), 100);
            emit(activity('codex-task', 'codex', 'subagent', 'Codex reviewer', 'running', 'Reviewing the mapper'), 120);
            emit(activity('pi-agent', 'pi', 'agent', 'Pi agent', 'running', 'Compacting context'), 140);
            emit(activity('claude-task', 'claude_code', 'subagent', 'Claude research', 'completed', 'SDK events mapped'), 2_500);
            emit(activity('codex-task', 'codex', 'subagent', 'Codex reviewer', 'completed', 'Mapper reviewed'), 2_520);
            emit(activity('pi-agent', 'pi', 'agent', 'Pi agent', 'completed', 'Agent settled'), 2_540);
            emit({ type: 'result', data: JSON.stringify({ usage: { input_tokens: 3, output_tokens: 5 } }) }, 2_560);
            emit({ type: 'done', data: '' }, 2_580);
            timers.push(window.setTimeout(() => {
              if (!closed) {
                closed = true;
                controller.close();
              }
            }, 2_600));
          } else {
            emit(activity('stop-child', 'codex', 'subagent', 'Stop-sensitive child', 'running', 'Initial child work'), 100);
            emit(activity('stop-child', 'codex', 'subagent', 'Stop-sensitive child', 'completed', 'FORBIDDEN LATE UPDATE'), 900);
          }
        },
        cancel() {
          closed = true;
          cleanup();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, { activeSessionId: sessionId, activeScenario: scenario });
}

test.describe('message child activity panel', () => {
  test('shows the same three-runtime activity UI, avoids tool duplication, folds on terminal state, and fits desktop/mobile', async ({ page }, testInfo) => {
    const sessionId = 'child-activity-terminal';
    await mockChatShell(page, sessionId);
    await installMockSSE(page, sessionId, 'terminal');
    await goToConversation(page, sessionId);
    await sendMessage(page, 'Run three child activities');

    const panel = page.getByTestId('child-activity-list');
    const trigger = page.getByTestId('child-activity-trigger');
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('child-activity-row')).toHaveCount(3);
    await expect(panel).toContainText('Claude research');
    await expect(panel).toContainText('Codex reviewer');
    await expect(panel).toContainText('Pi agent');
    await expect(panel).not.toContainText('Read');

    await page.screenshot({ path: testInfo.outputPath('child-activity-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('child-activity-390px.png'), fullPage: true });

    await expect(trigger).toHaveAttribute('data-state', 'closed', { timeout: 5_000 });
    await expect(page.getByTestId('child-activity-content')).toBeHidden();
    await trigger.click();
    await expect(panel).toContainText('completed');
  });

  test('manual Stop terminates once and rejects late activity updates', async ({ page }) => {
    const sessionId = 'child-activity-stop';
    let stopCalls = 0;
    await mockChatShell(page, sessionId);
    await page.route('**/api/chat/stop', async (route) => {
      stopCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stopped: true }) });
    });
    await installMockSSE(page, sessionId, 'stop');
    await goToConversation(page, sessionId);
    await sendMessage(page, 'Start and then stop a child');

    const panel = page.getByTestId('child-activity-list');
    await expect(panel).toContainText('Initial child work');
    await expect(stopButton(page)).toBeVisible();
    await stopButton(page).click();
    await expect(page.getByTestId('child-activity-trigger')).toHaveAttribute('data-state', 'closed');
    await page.getByTestId('child-activity-trigger').click();
    await expect(panel).toContainText('stopped');
    await page.waitForTimeout(1_100);
    await expect(panel).not.toContainText('FORBIDDEN LATE UPDATE');
    expect(stopCalls).toBe(1);
  });
});
