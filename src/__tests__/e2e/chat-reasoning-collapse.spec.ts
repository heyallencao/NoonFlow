import { expect, test } from '@playwright/test';

const SESSION_ID = 'chat-reasoning-collapse';

function buildSession() {
  return {
    id: SESSION_ID,
    title: 'Reasoning Collapse Check',
    created_at: '2026-03-24 10:00:00',
    updated_at: '2026-03-24 10:00:00',
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
    runtime_updated_at: '2026-03-24 10:00:00',
    runtime_error: '',
    assistant_runtime: 'codex',
    assistant_runtime_version: '',
  };
}

test('reasoning traces longer than the compact character limit start collapsed', async ({ page }) => {
  const shortReasoning = ['短思路第一行。', '短思路第二行。'].join('\n');
  const longReasoning = [
    '长思路第一行，先把问题拆开，再把每个限制条件逐个列清楚，避免直接跳到结论，同时把边界、前提和已经知道的事实都写完整。',
    '长思路第二行，把已有上下文和这次输入之间的关系补齐，确认没有遗漏前提，再把哪部分是用户明确说过的，哪部分是系统推出来的，全部分开标注。',
    '长思路第三行，再把备选方案按风险和收益排一下，看看哪个更适合当前会话，并把那些看起来可行但其实会引入额外复杂度的路径一并排除掉。',
    '长思路第四行，最后整理成可执行动作，确保这段文本明显超过默认阈值，而且每一步都能落到实际操作，不只是停留在模糊建议上。',
    '长思路第五行，再补充一次验收口径、失败回退和边界情况，让这一段在任何情况下都足够长，避免贴近阈值造成测试不稳定。',
  ].join('\n');

  const longAssistantContent = JSON.stringify([
    {
      type: 'reasoning',
      text: longReasoning,
    },
    {
      type: 'text',
      text: '这是长思路后的正文。',
    },
  ]);

  const shortAssistantContent = JSON.stringify([
    {
      type: 'reasoning',
      text: shortReasoning,
    },
    {
      type: 'text',
      text: '这是短思路后的正文。',
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
            content: '检查思考过程默认折叠',
            created_at: '2026-03-24T10:00:00.000Z',
            token_usage: null,
          },
          {
            id: 'msg-assistant-1',
            session_id: SESSION_ID,
            role: 'assistant',
            content: longAssistantContent,
            created_at: '2026-03-24T10:00:01.000Z',
            token_usage: null,
          },
          {
            id: 'msg-assistant-2',
            session_id: SESSION_ID,
            role: 'assistant',
            content: shortAssistantContent,
            created_at: '2026-03-24T10:00:02.000Z',
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

  const longReasoningBlock = page.locator('[data-testid="message-reasoning"][data-auto-collapsed="true"]').first();
  const shortReasoningBlock = page.locator('[data-testid="message-reasoning"][data-auto-collapsed="false"]').first();
  const longReasoningTrigger = longReasoningBlock.locator('[data-testid="message-reasoning-trigger"]');
  const shortReasoningTrigger = shortReasoningBlock.locator('[data-testid="message-reasoning-trigger"]');

  await expect(longReasoningBlock).toBeVisible();
  await expect(shortReasoningBlock).toBeVisible();
  await expect(longReasoningTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(shortReasoningTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(shortReasoningBlock.locator('[data-testid="message-reasoning-content"]')).toBeVisible();
  await expect(shortReasoningBlock.getByText('短思路第一行。')).toBeVisible();

  await longReasoningTrigger.click();
  await expect(longReasoningTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(longReasoningBlock.locator('[data-testid="message-reasoning-content"]')).toBeVisible();
  await expect(longReasoningBlock.getByText('长思路第五行，再补充一次验收口径、失败回退和边界情况，让这一段在任何情况下都足够长，避免贴近阈值造成测试不稳定。')).toBeVisible();

  await longReasoningTrigger.click();
  await expect(longReasoningTrigger).toHaveAttribute('aria-expanded', 'false');
});
