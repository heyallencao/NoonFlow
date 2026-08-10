import { expect, test } from '@playwright/test';

const SESSION_ID = 'chat-alignment-check';

function buildSession() {
  return {
    id: SESSION_ID,
    title: 'Alignment Check',
    created_at: '2026-03-23 10:00:00',
    updated_at: '2026-03-23 10:00:00',
    session_type: 'chat',
    model: 'gpt-5',
    system_prompt: '',
    working_directory: '/tmp/monolith-e2e-workspace',
    sdk_session_id: '',
    project_name: 'Monolith',
    status: 'active',
    mode: 'code',
    provider_name: '',
    provider_id: '',
    sdk_cwd: '',
    runtime_status: 'idle',
    runtime_updated_at: '2026-03-23 10:00:00',
    runtime_error: '',
    assistant_runtime: 'codex',
    assistant_runtime_version: '',
  };
}

test('reasoning, tool and body blocks stay aligned and reasoning code is smaller', async ({ page }) => {
  const assistantContent = JSON.stringify([
    {
      type: 'reasoning',
      text: [
        '这是思考过程。',
        '',
        '```ts',
        'const answer = 42;',
        'console.log(answer);',
        '```',
      ].join('\n'),
    },
    {
      type: 'tool_use',
      id: 'tool-1',
      name: 'exec_command',
      input: { cmd: 'echo hello' },
    },
    {
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'hello',
      is_error: false,
    },
    {
      type: 'text',
      text: '这是正文第一段。\n\n这是正文第二段，用来检查左边是否和上面的两块对齐。',
    },
  ]);

  await page.route(`**/api/chat/sessions/${SESSION_ID}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: buildSession(),
        recovery: null,
        runtimeState: null,
      }),
    });
  });

  await page.route(`**/api/chat/sessions/${SESSION_ID}/messages?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            id: 'msg-user-1',
            session_id: SESSION_ID,
            role: 'user',
            content: '帮我看布局',
            created_at: '2026-03-23T10:00:00.000Z',
            token_usage: null,
          },
          {
            id: 'msg-assistant-1',
            session_id: SESSION_ID,
            role: 'assistant',
            content: assistantContent,
            created_at: '2026-03-23T10:00:01.000Z',
            token_usage: null,
          },
        ],
        hasMore: false,
      }),
    });
  });

  await page.route('**/api/chat/sessions?type=all**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [buildSession()],
      }),
    });
  });

  await page.route('**/api/settings/app', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settings: {
          chat_reasoning_enabled: 'true',
          default_assistant_runtime: 'codex',
          codex_default_model: 'gpt-5',
        },
      }),
    });
  });

  await page.route('**/api/assistant-runtimes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runtimes: [
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
        ],
      }),
    });
  });

  await page.route('**/api/providers/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        groups: [],
        default_provider_id: 'env',
      }),
    });
  });

  await page.goto(`/chat/${SESSION_ID}`);

  const reasoningTrigger = page.locator('[data-testid="message-reasoning-trigger"]').first();
  const toolRow = page.getByText('echo hello').first();
  const bodyParagraph = page.getByText('这是正文第一段。').first();
  const reasoningCode = page.locator('.is-assistant code').filter({ hasText: 'const answer = 42;' }).first();

  await expect(reasoningTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(toolRow).toBeVisible();
  await expect(bodyParagraph).toBeVisible();
  await expect(reasoningCode).toBeVisible();

  const toolBox = await toolRow.boundingBox();
  const bodyBox = await bodyParagraph.boundingBox();
  const codeFontSize = await reasoningCode.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

  expect(toolBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();

  expect(Math.abs((toolBox?.x ?? 0) - (bodyBox?.x ?? 0))).toBeLessThanOrEqual(28);
  expect(codeFontSize).toBeLessThanOrEqual(10.5);
});

test('consecutive tool-only assistant messages stay visually compact', async ({ page }) => {
  const sessionId = 'chat-tool-density-check';
  const session = { ...buildSession(), id: sessionId, title: 'Tool Density Check' };
  const toolMessage = (id: string, command: string, createdAt: string) => ({
    id: `msg-${id}`,
    session_id: sessionId,
    role: 'assistant',
    content: JSON.stringify([
      {
        type: 'tool_use',
        id,
        name: 'exec_command',
        input: { command },
      },
      {
        type: 'tool_result',
        tool_use_id: id,
        content: '',
        is_error: false,
      },
    ]),
    created_at: createdAt,
    token_usage: null,
  });

  await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session, recovery: null, runtimeState: null }),
    });
  });

  await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            id: 'msg-user-density',
            session_id: sessionId,
            role: 'user',
            content: 'Run two commands',
            created_at: '2026-03-23T10:00:00.000Z',
            token_usage: null,
          },
          toolMessage('tool-density-1', 'echo compact-one', '2026-03-23T10:00:01.000Z'),
          toolMessage('tool-density-2', 'echo compact-two', '2026-03-23T10:00:02.000Z'),
        ],
        hasMore: false,
      }),
    });
  });

  await page.route('**/api/chat/sessions?type=all**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [session] }),
    });
  });

  await page.goto(`/chat/${sessionId}`);

  const firstCommand = page.getByText('echo compact-one', { exact: true });
  const secondCommand = page.getByText('echo compact-two', { exact: true });
  await expect(firstCommand).toBeVisible();
  await expect(secondCommand).toBeVisible();

  const firstBox = await firstCommand.boundingBox();
  const secondBox = await secondCommand.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect((secondBox?.y ?? 0) - (firstBox?.y ?? 0)).toBeLessThanOrEqual(44);
});

test('custom exec calls render the raw command as a command row', async ({ page }) => {
  const sessionId = 'chat-exec-alias-check';
  const session = { ...buildSession(), id: sessionId, title: 'Exec Alias Check' };
  const command = 'printf compact-exec-alias';

  await page.route(`**/api/chat/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session, recovery: null, runtimeState: null }),
    });
  });

  await page.route(`**/api/chat/sessions/${sessionId}/messages?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            id: 'msg-exec-alias',
            session_id: sessionId,
            role: 'assistant',
            content: JSON.stringify([
              { type: 'tool_use', id: 'tool-exec-alias', name: 'exec', input: command },
              { type: 'tool_result', tool_use_id: 'tool-exec-alias', content: '', is_error: false },
            ]),
            created_at: '2026-03-23T10:00:01.000Z',
            token_usage: null,
          },
        ],
        hasMore: false,
      }),
    });
  });

  await page.route('**/api/chat/sessions?type=all**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [session] }),
    });
  });

  await page.goto(`/chat/${sessionId}`);

  await expect(page.getByText(command, { exact: true })).toBeVisible();
  await expect(page.getByText('exec', { exact: true })).toHaveCount(0);
});
