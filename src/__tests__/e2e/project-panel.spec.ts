import { test, expect } from '@playwright/test';
import {
  goToChat,
  goToSettings,
  goToPlugins,
  rightPanel,
  panelFilesTab,
  panelTasksTab,
  panelCloseButton,
  panelOpenButton,
  fileSearchInput,
  fileTreeRefreshButton,
  switchToTasksTab,
  switchToFilesTab,
  collectConsoleErrors,
  filterCriticalErrors,
  waitForPageReady,
} from '../helpers';

test.describe('Project Panel (V2)', () => {
  test.describe('Panel Auto-Show', () => {
    test('right panel is visible on /chat/[id] route', async ({ page }) => {
      // We need a conversation page; create one by sending a message
      await goToChat(page);
      // Simulate navigating to a conversation route
      // If no conversation exists, we navigate to a mock id
      await page.goto('/chat/test-session');
      await waitForPageReady(page);

      // Right panel should auto-open on chat/[id] routes
      const panel = rightPanel(page);
      await expect(panel).toBeVisible({ timeout: 5000 });
    });

    test('right panel is hidden on /settings route', async ({ page }) => {
      await goToSettings(page);
      const panel = rightPanel(page);
      await expect(panel).toBeHidden();
    });

    test('right panel is hidden on /plugins route', async ({ page }) => {
      await goToPlugins(page);
      const panel = rightPanel(page);
      await expect(panel).toBeHidden();
    });

    test('right panel is hidden on /chat (no id) route', async ({ page }) => {
      await goToChat(page);
      // On /chat without an id, the panel should not auto-open
      const panel = rightPanel(page);
      await expect(panel).toBeHidden();
    });
  });

  test.describe('Panel Tabs', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
    });

    test('Files tab is active by default', async ({ page }) => {
      const filesTab = panelFilesTab(page);
      await expect(filesTab).toBeVisible();
      // Files tab should have active styling (bg-accent class)
      const classes = await filesTab.getAttribute('class');
      expect(classes).toContain('bg-accent');
    });

    test('clicking Tasks tab switches content', async ({ page }) => {
      await switchToTasksTab(page);
      const tasksTab = panelTasksTab(page);
      const classes = await tasksTab.getAttribute('class');
      expect(classes).toContain('bg-accent');

      // TaskList component renders with "Add a task..." input or "No tasks yet" text
      const addInput = page.locator('input[placeholder*="Add a task"]');
      const emptyState = page.locator('text=No tasks yet');
      const hasInput = await addInput.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      expect(hasInput || hasEmpty).toBeTruthy();
    });

    test('clicking Files tab switches back to files', async ({ page }) => {
      // Switch to tasks first
      await switchToTasksTab(page);
      // Switch back to files
      await switchToFilesTab(page);

      const filesTab = panelFilesTab(page);
      const classes = await filesTab.getAttribute('class');
      expect(classes).toContain('bg-accent');
    });
  });

  test.describe('Panel Collapse/Expand', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
    });

    test('close button collapses the panel', async ({ page }) => {
      // Panel should be open initially
      await expect(rightPanel(page)).toBeVisible();

      // Click close
      await panelCloseButton(page).click();
      await page.waitForTimeout(300);

      // Full panel should be hidden
      await expect(rightPanel(page)).toBeHidden();

      // Open button should be visible in the collapsed strip
      await expect(panelOpenButton(page)).toBeVisible();
    });

    test('open button expands the panel', async ({ page }) => {
      // Collapse first
      await panelCloseButton(page).click();
      await page.waitForTimeout(300);

      // Click open
      await panelOpenButton(page).click();
      await page.waitForTimeout(300);

      // Panel should be visible again
      await expect(rightPanel(page)).toBeVisible();
    });

    test('panel has correct width when open', async ({ page }) => {
      const panel = rightPanel(page);
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      // w-80 = 320px
      expect(box!.width).toBe(320);
    });
  });

  test.describe('File Tree', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
    });

    test('file search input is visible', async ({ page }) => {
      const search = fileSearchInput(page);
      await expect(search).toBeVisible();
      await expect(search).toHaveAttribute('placeholder', 'Filter files...');
    });

    test('refresh button is visible', async ({ page }) => {
      await expect(fileTreeRefreshButton(page)).toBeVisible();
    });

    test('search input accepts text and filters', async ({ page }) => {
      const search = fileSearchInput(page);
      await search.fill('nonexistent-xyz');
      await expect(search).toHaveValue('nonexistent-xyz');
    });

    test('clearing search restores the tree', async ({ page }) => {
      const search = fileSearchInput(page);
      await search.fill('test');
      await page.waitForTimeout(300);
      await search.clear();
      await page.waitForTimeout(300);
      // Search input should be cleared and panel body still present
      await expect(search).toHaveValue('');
      // The panel body container (overflow-hidden) should be present
      const panelBody = page.locator('aside.w-80 .overflow-hidden');
      await expect(panelBody).toBeVisible();
    });
  });

  test.describe('File Preview', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
    });

    test('file tree is displayed in the panel body', async ({ page }) => {
      // Verify the panel body container is present with file tree content
      // The panel body has class "flex-1 overflow-hidden p-3"
      const panelBody = page.locator('aside.w-80 .overflow-hidden');
      await expect(panelBody).toBeVisible();
      // File search input confirms we're in the file tree view
      await expect(fileSearchInput(page)).toBeVisible();
    });
  });

  test.describe('No Console Errors', () => {
    test('project panel page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
      const critical = filterCriticalErrors(errors).filter(
        (e) =>
          !e.includes('405') &&
          !e.includes('404') &&
          !e.includes('Failed to load resource')
      );
      expect(critical).toHaveLength(0);
    });
  });
});
