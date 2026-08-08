import { expect, test } from '@playwright/test';
import { collectConsoleErrors, filterCriticalErrors, waitForPageReady } from '../helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('noonflow:opened-workspaces', JSON.stringify([
      '/workspace/demo-app',
      '/workspace/design-system',
    ]));
    localStorage.setItem('monolith:last-working-directory', '/workspace/demo-app');
  });

  await page.route('**/api/chat/sessions?**', async (route) => {
    await route.fulfill({ json: { sessions: [] } });
  });
});

test.describe('Focused dashboard', () => {
  test('root redirects to the focused workspace overview', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/');
    await waitForPageReady(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Claude Code 与 Codex，本地直接使用' })).toBeVisible();
    await expect(page.getByText('会话历史由 Claude Code 或 Codex 原生保存')).toBeVisible();
    await expect(page.getByRole('link', { name: '检查运行环境' })).toHaveAttribute('href', '/settings');

    const sidebar = page.locator('aside');
    await expect(sidebar).toContainText(/Workbench|工作台/);
    await expect(sidebar).toContainText(/Automation|自动化/);
    await expect(sidebar).toContainText(/Workspace|工作区/);
    await expect(sidebar).not.toContainText(/Monitor|监控/);
    await expect(sidebar).not.toContainText(/Bridge|桥接/);

    expect(filterCriticalErrors(errors)).toHaveLength(0);
  });
});
