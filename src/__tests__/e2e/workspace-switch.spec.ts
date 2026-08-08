import { expect, test, type Page } from '@playwright/test';
import { goToConversation } from '../helpers';

function buildMockSession(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    title: 'Mock Conversation',
    created_at: '2026-03-14 10:00:00',
    updated_at: '2026-03-14 10:00:00',
    session_type: 'chat',
    model: 'gpt-5',
    system_prompt: '',
    working_directory: '/tmp/mock-workspace',
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
    ...overrides,
  };
}

function workspaceCard(page: Page, name: string) {
  return page
    .locator('div[role="group"]')
    .filter({
      has: page.getByRole('button', { name: new RegExp(`^${name}$`) }),
    })
    .first();
}

test.describe('Workspace Switching', () => {
  test('keeps the current workspace active until the target session route is ready', async ({ page }) => {
    const workspaceA = '/tmp/workspace-a';
    const workspaceB = '/tmp/workspace-b';
    const sessionA = buildMockSession('workspace-a-session', {
      title: 'Workspace A Session',
      working_directory: workspaceA,
      project_name: 'workspace-a',
    });
    const sessionB = buildMockSession('workspace-b-session', {
      title: 'Workspace B Session',
      working_directory: workspaceB,
      project_name: 'workspace-b',
      updated_at: '2026-03-14 11:00:00',
    });

    let sessions = [sessionA];
    const createRequestSeenRef: {
      current: ((value: void | PromiseLike<void>) => void) | null;
    } = { current: null };
    const createResponseGateRef: {
      current: ((value: void | PromiseLike<void>) => void) | null;
    } = { current: null };
    const createRequestSeen = new Promise<void>((resolve) => {
      createRequestSeenRef.current = resolve;
    });
    const createResponseGate = new Promise<void>((resolve) => {
      createResponseGateRef.current = resolve;
    });

    await page.addInitScript(
      ({ workspaces, lastWorkspace }) => {
        localStorage.setItem('noonflow:opened-workspaces', JSON.stringify(workspaces));
        localStorage.setItem('monolith:last-working-directory', lastWorkspace);
        localStorage.removeItem('monolith:hidden-workspaces');
      },
      {
        workspaces: [workspaceA, workspaceB],
        lastWorkspace: workspaceA,
      }
    );

    await page.route('**/api/chat/sessions?**', async (route) => {
      const url = new URL(route.request().url());
      const workspace = url.searchParams.get('workspace');
      const filteredSessions = workspace
        ? sessions.filter((session) => session.working_directory === workspace)
        : sessions;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: filteredSessions,
          deleted_session_ids: [],
          next_cursor: null,
        }),
      });
    });

    await page.route('**/api/chat/sessions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      createRequestSeenRef.current?.(undefined);
      await createResponseGate;
      sessions = [sessionA, sessionB];

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          session: sessionB,
        }),
      });
    });

    await page.route('**/api/chat/sessions/*/messages?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [],
          hasMore: false,
        }),
      });
    });

    await page.route('**/api/chat/sessions/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      const sessionId = route.request().url().split('/').pop() || '';
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Session not found' }),
        });
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

    await goToConversation(page, sessionA.id);

    const workspaceACard = workspaceCard(page, 'workspace-a');
    const workspaceBCard = workspaceCard(page, 'workspace-b');
    await expect(workspaceACard).toBeVisible();
    await expect(workspaceBCard).toBeVisible();
    await expect(workspaceACard).toHaveClass(/from-bg-hover/);
    await expect(workspaceBCard).not.toHaveClass(/from-bg-hover/);

    await page.getByRole('button', { name: /^workspace-b$/ }).click();

    await createRequestSeen;
    await page.waitForTimeout(150);

    await expect(page).toHaveURL(new RegExp(`/chat/${sessionA.id}$`));
    await expect(workspaceACard).toHaveClass(/from-bg-hover/);
    await expect(workspaceBCard).not.toHaveClass(/from-bg-hover/);
    await expect(page.getByText('Workspace A Session').first()).toBeVisible();

    if (!createResponseGateRef.current) {
      throw new Error('Create response gate was not initialized');
    }
    createResponseGateRef.current(undefined);

    await expect(page).toHaveURL(new RegExp(`/chat/${sessionB.id}$`));
    await expect(workspaceBCard).toHaveClass(/from-bg-hover/);
    await expect(page.getByText('Workspace B Session').first()).toBeVisible();
  });

});
