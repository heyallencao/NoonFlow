import { expect, test } from '@playwright/test';
import { collectConsoleErrors, filterCriticalErrors, waitForPageReady } from '../helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('monolith:workspace-folders', JSON.stringify([
      '/workspace/demo-app',
      '/workspace/design-system',
    ]));
    localStorage.setItem('monolith:last-working-directory', '/workspace/demo-app');
  });

  await page.route('**/api/dashboard/meta', async (route) => {
    await route.fulfill({
      json: {
        username: 'allen',
        hooksCount: 2,
        permissionsCount: 5,
      },
    });
  });

  await page.route('**/api/dashboard/weather', async (route) => {
    await route.fulfill({
      json: {
        location: 'Shanghai',
        temperatureC: 22,
        description: 'Cloudy',
      },
    });
  });

  await page.route('**/api/usage/stats?days=30', async (route) => {
    await route.fulfill({
      json: {
        summary: {
          total_input_tokens: 1200,
          total_output_tokens: 3400,
          total_cost: 12.34,
          total_sessions: 2,
          cache_read_tokens: 300,
          cache_creation_tokens: 40,
        },
        costMeta: {
          mode: 'actual',
        },
      },
    });
  });

  await page.route('**/api/usage/stats?days=365', async (route) => {
    await route.fulfill({
      json: {
        byModel: [
          { model: 'gpt-5.4', cost: 8.12 },
          { model: 'claude-sonnet-4-5', cost: 4.22 },
        ],
      },
    });
  });

  await page.route('**/api/sessions/stats?days=30', async (route) => {
    await route.fulfill({
      json: {
        summary: {
          totalSessions: 14,
        },
        byWorkspace: [
          { workspacePath: '/workspace/demo-app', count: 9, messageCount: 42, lastUpdated: '2026-04-04T12:30:00.000Z' },
          { workspacePath: '/workspace/design-system', count: 5, messageCount: 20, lastUpdated: '2026-04-04T10:30:00.000Z' },
        ],
      },
    });
  });

  await page.route('**/api/sessions/stats?days=365', async (route) => {
    await route.fulfill({
      json: {
        recentSessions: [
          {
            id: 'session-1',
            title: 'Fix spacing',
            workingDirectory: '/workspace/demo-app',
            updatedAt: '2026-04-04T12:30:00.000Z',
            messageCount: 12,
            assistantRuntime: 'codex',
          },
          {
            id: 'session-2',
            title: 'Review onboarding',
            workingDirectory: '/workspace/demo-app',
            updatedAt: '2026-04-04T11:30:00.000Z',
            messageCount: 8,
            assistantRuntime: 'claude_code',
          },
          {
            id: 'session-3',
            title: 'Design tokens',
            workingDirectory: '/workspace/design-system',
            updatedAt: '2026-04-03T18:30:00.000Z',
            messageCount: 5,
            assistantRuntime: 'codex',
          },
        ],
      },
    });
  });

  await page.route('**/api/sessions/stats?days=15', async (route) => {
    await route.fulfill({
      json: {
        activityHeatmap: [
          { date: '2026-04-02', count: 2 },
          { date: '2026-04-03', count: 3 },
          { date: '2026-04-04', count: 4 },
        ],
      },
    });
  });

  await page.route('**/api/sessions/stats?days=1', async (route) => {
    await route.fulfill({
      json: {
        rollingHourlyDistribution: Array.from({ length: 24 }, (_, index) => ({
          hourStart: new Date(Date.UTC(2026, 3, 4, index, 0, 0)).toISOString(),
          count: index === 10 ? 2 : 0,
        })),
      },
    });
  });

  await page.route('**/api/work-graph?**', async (route) => {
    const url = new URL(route.request().url());
    const workspace = url.searchParams.get('workspace');
    const today = new Date().toISOString().slice(0, 10);

    if (workspace === '/workspace/demo-app') {
      await route.fulfill({
        json: {
          commitActivity: [{ date: today, count: 2 }],
          allRepos: [{ path: '/workspace/demo-app' }, { path: '/workspace/demo-app/packages/ui' }],
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        commitActivity: [{ date: today, count: 1 }],
        allRepos: [{ path: '/workspace/design-system' }],
      },
    });
  });

  await page.route('**/api/hygiene?**', async (route) => {
    const url = new URL(route.request().url());
    const workspace = url.searchParams.get('workspace');

    if (workspace === '/workspace/demo-app') {
      await route.fulfill({
        json: {
          summary: { totalFindings: 1, critical: 1, warning: 0 },
          findings: [
            {
              findingId: 'demo-dirty',
              type: 'uncommitted-changes',
              severity: 'critical',
              title: 'Dirty repo',
              description: '12 files changed',
              count: 12,
              repoRoot: '/workspace/demo-app',
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        summary: { totalFindings: 0, critical: 0, warning: 0 },
        findings: [],
      },
    });
  });

  await page.route('**/api/widget/telemetry?days=7', async (route) => {
    await route.fulfill({
      json: {
        summary: { totalEvents: 0, errorEvents: 0 },
        byEvent: [],
        byCode: [],
      },
    });
  });

  await page.route('**/api/settings/app', async (route) => {
    await route.fulfill({ json: { settings: {} } });
  });

  await page.route('**/api/dashboard/recommendations', async (route) => {
    await route.fulfill({ json: { recommendations: [] } });
  });

  await page.route('**/api/skills', async (route) => {
    await route.fulfill({
      json: {
        skills: [
          { name: 'review', description: 'Review skill', source: 'global' },
        ],
      },
    });
  });

  await page.route('**/api/hooks', async (route) => {
    await route.fulfill({
      json: {
        hooks: [
          { id: 'hook-1', runtime: 'codex', event: 'pre-command' },
        ],
      },
    });
  });

  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      json: {
        agents: [
          { id: 'agent-1', runtime: 'codex', name: 'reviewer' },
        ],
      },
    });
  });

  await page.route('**/api/memory/archives', async (route) => {
    await route.fulfill({
      json: {
        archives: [
          { id: 'archive-1', workspaceName: 'demo-app', archivedAt: '2026-04-04T00:00:00.000Z' },
        ],
      },
    });
  });

  await page.route('**/api/settings', async (route) => {
    await route.fulfill({
      json: {
        settings: {
          allowedTools: ['read', 'write'],
          hooks: {
            preCommand: [],
          },
        },
      },
    });
  });
});

test.describe('Overview IA and UX', () => {
  test('root redirects to overview and shows the new navigation structure', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/');
    await waitForPageReady(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/You have 3 repos set up\.|你已配置 3 个仓库。/)).toBeVisible();
    await expect(page.getByText(/Recent Sessions|最近会话/)).toBeVisible();
    await expect(page.locator('aside')).toContainText(/Workbench|工作台/);
    await expect(page.locator('aside')).toContainText(/Monitor|监控/);
    await expect(page.locator('aside')).toContainText(/Workspace|工作区/);
    await expect(page.locator('aside')).toContainText(/Automation|自动化/);
    await expect(page.locator('aside')).not.toContainText(/Terminal|终端/);

    expect(filterCriticalErrors(errors)).toHaveLength(0);
  });

  test('overview uses live stats from the current route set', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await expect(page.getByText('$12.34')).toBeVisible();
    await expect(page.getByText(/Fix spacing/)).toBeVisible();
    await expect(page.getByText(/Review onboarding/)).toBeVisible();
    await expect(page.getByText(/Cost by Model|按模型成本/)).toBeVisible();
    await expect(page.getByText(/Skills|技能/)).toBeVisible();
    await expect(page.getByTestId('overview-new-chat')).toHaveCount(0);
    await expect(page.getByTestId('overview-new-terminal')).toHaveCount(0);
  });

  test('overview aggregates hygiene alerts across visible workspaces', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForPageReady(page);

    await expect(page.getByText(/repository health alerts need attention|仓库健康提醒待处理/)).toBeVisible();
  });
});
