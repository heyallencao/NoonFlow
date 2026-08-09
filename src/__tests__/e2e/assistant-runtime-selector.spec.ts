import { test, expect } from '@playwright/test';

test.describe('Assistant Runtime Selector', () => {
  test('Codex sessions render Codex input and send assistant_runtime in chat requests', async ({ page }) => {
    const sessionId = 'assistant-runtime-e2e';
    const currentRuntime: 'claude_code' | 'codex' | 'pi' = 'codex';
    const currentModel = 'gpt-5';
    const currentProviderId = '';
    let messagesRequestCount = 0;
    let chatPayload: {
      assistant_runtime?: string;
      model?: string;
    } | null = null;

    const buildSessionResponse = () => ({
      session: {
        id: sessionId,
        title: 'Assistant Runtime Test',
        created_at: '2026-03-13 10:00:00',
        updated_at: '2026-03-13 10:00:00',
        session_type: 'chat',
        model: currentModel,
        system_prompt: '',
        working_directory: '/tmp/assistant-runtime-test',
        sdk_session_id: '',
        project_name: 'assistant-runtime-test',
        status: 'active',
        mode: 'code',
        provider_name: '',
        provider_id: currentProviderId,
        sdk_cwd: '/tmp/assistant-runtime-test',
        runtime_status: 'idle',
        runtime_updated_at: '2026-03-13 10:00:00',
        runtime_error: '',
        assistant_runtime: currentRuntime,
        assistant_runtime_version: '',
      },
      recovery: null,
      runtimeState: null,
    });

    await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildSessionResponse()),
      });
    });

    await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
      messagesRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: messagesRequestCount === 1
            ? []
            : [
                {
                  id: 'msg-user-1',
                  session_id: sessionId,
                  role: 'user',
                  content: 'Run with Codex',
                  created_at: '2026-03-13T10:00:00.000Z',
                  token_usage: null,
                },
                {
                  id: 'msg-assistant-1',
                  session_id: sessionId,
                  role: 'assistant',
                  content: 'Codex response',
                  created_at: '2026-03-13T10:00:01.000Z',
                  token_usage: null,
                },
              ],
          hasMore: false,
        }),
      });
    });

    await page.route('**/api/chat/sessions?type=all', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [buildSessionResponse().session],
          deleted_session_ids: [],
          next_cursor: 1,
        }),
      });
    });

    await page.route('**/api/assistant-runtimes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          default_assistant_runtime: 'claude_code',
          runtimes: [
            {
              id: 'claude_code',
              label: 'Claude Code',
              enabled: true,
              available: true,
              installed: true,
              configured: true,
              supports_plan_mode: true,
              supports_permissions: true,
            },
            {
              id: 'codex',
              label: 'Codex',
              enabled: true,
              available: true,
              installed: true,
              configured: true,
              supports_plan_mode: true,
              supports_permissions: false,
            },
            {
              id: 'pi',
              label: 'Pi',
              enabled: true,
              available: true,
              installed: true,
              configured: true,
              supports_plan_mode: true,
              supports_permissions: false,
            },
          ],
        }),
      });
    });

    await page.route('**/api/settings/app', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          settings: {
            default_assistant_runtime: 'claude_code',
            codex_default_model: 'codex-mini-latest',
          },
        }),
      });
    });

    await page.route('**/api/providers/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              provider_id: 'env',
              provider_name: 'Anthropic',
              provider_type: 'anthropic',
              models: [{ value: 'sonnet', label: 'Sonnet 4.6' }],
            },
          ],
          default_provider_id: 'env',
        }),
      });
    });

    await page.route('**/api/chat', async (route) => {
      chatPayload = route.request().postDataJSON() as {
        assistant_runtime?: string;
        model?: string;
      };
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: [
          `data: ${JSON.stringify({ type: 'status', data: JSON.stringify({ session_id: 'codex-thread-1', model: 'codex-mini-latest' }) })}`,
          '',
          `data: ${JSON.stringify({ type: 'text', data: 'Codex response' })}`,
          '',
          `data: ${JSON.stringify({ type: 'result', data: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 20 } }) })}`,
          '',
          `data: ${JSON.stringify({ type: 'done', data: '' })}`,
          '',
        ].join('\n'),
      });
    });

    await page.goto(`/chat/${sessionId}`);
    await expect(page.getByRole('button', { name: /Pi/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Describe your task, use @ for files, / for commands' })).toBeVisible();

    const input = page.getByRole('textbox', { name: 'Describe your task, use @ for files, / for commands' });
    await input.fill('Run with Codex');
    await input.press('Enter');

    await expect(page.locator('main >> text=Run with Codex').first()).toBeVisible();
    await expect(page.locator('main >> text=Codex response').first()).toBeVisible();

    const capturedChatPayload = chatPayload as {
      assistant_runtime?: string;
      model?: string;
    } | null;
    expect(capturedChatPayload).not.toBeNull();
    expect(capturedChatPayload?.assistant_runtime).toBe('codex');
    expect(capturedChatPayload?.model).toBe('gpt-5');
  });
});
