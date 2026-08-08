import { test, expect } from '@playwright/test';
import {
  goToPlugins,
  goToMCP,
  addServerButton,
  collectConsoleErrors,
  filterCriticalErrors,
  expectPageLoadTime,
  waitForPageReady,
} from '../helpers';

test.describe('Plugins Page', () => {
  test.describe('Page Rendering', () => {
    test('plugins page loads within 3 seconds', async ({ page }) => {
      await expectPageLoadTime(page, '/plugins');
    });

    test('MCP management page loads within 3 seconds', async ({ page }) => {
      await expectPageLoadTime(page, '/plugins/mcp');
    });

    test('plugins page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToPlugins(page);
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });

    test('MCP page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToMCP(page);
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });
  });

  test.describe('Plugins Landing Page (V2)', () => {
    test('page title and description visible', async ({ page }) => {
      await goToPlugins(page);
      await expect(page.locator('h1:has-text("Plugins & Skills")')).toBeVisible();
      // V2: description now directs users to settings
      await expect(
        page.locator('text=Skills management has moved to Settings')
      ).toBeVisible();
    });

    test('Manage Skills button links to /settings?tab=skills', async ({ page }) => {
      await goToPlugins(page);
      const skillsBtn = page.locator('a[href="/settings?tab=skills"]');
      await expect(skillsBtn).toBeVisible();
    });

    test('MCP Servers button links to /plugins/mcp', async ({ page }) => {
      await goToPlugins(page);
      // Use main content area to avoid matching the sidebar nav link
      const mcpBtn = page.locator('main a[href="/plugins/mcp"], .container a[href="/plugins/mcp"]').first();
      await expect(mcpBtn).toBeVisible();
    });

    test('clicking Manage Skills navigates to settings skills tab', async ({ page }) => {
      await goToPlugins(page);
      await page.locator('a[href="/settings?tab=skills"]').click();
      await waitForPageReady(page);
      expect(page.url()).toContain('/settings');
      expect(page.url()).toContain('tab=skills');
    });
  });

  test.describe('Navigate to MCP', () => {
    test('clicking MCP Servers button navigates to /plugins/mcp', async ({ page }) => {
      await goToPlugins(page);
      // Use the main content area link, not sidebar nav
      await page.locator('main a[href="/plugins/mcp"], .container a[href="/plugins/mcp"]').first().click();
      await waitForPageReady(page);
      expect(page.url()).toContain('/plugins/mcp');
    });
  });

  test.describe('MCP Server List', () => {
    test('MCP page title and description visible', async ({ page }) => {
      await goToMCP(page);
      // The main content area has the h1 title
      await expect(page.locator('.container h1:has-text("MCP Servers")')).toBeVisible();
      await expect(
        page.locator('text=Configure Model Context Protocol servers for Claude')
      ).toBeVisible();
    });

    test('Add Server button is visible', async ({ page }) => {
      await goToMCP(page);
      await expect(addServerButton(page)).toBeVisible();
    });

    test('Servers and JSON Config tabs are visible', async ({ page }) => {
      await goToMCP(page);
      await expect(page.locator('button:has-text("Servers")')).toBeVisible();
      await expect(page.locator('button:has-text("JSON Config")')).toBeVisible();
    });

    test('empty state shows when no servers configured', async ({ page }) => {
      await goToMCP(page);
      await expect(page.locator('text=No MCP servers configured')).toBeVisible();
    });

    test('back link navigates to /plugins', async ({ page }) => {
      await goToMCP(page);
      const backLink = page.locator('a[href="/plugins"]').first();
      await expect(backLink).toBeVisible();
    });
  });

  test.describe('Add MCP Server', () => {
    test('clicking Add Server opens dialog', async ({ page }) => {
      await goToMCP(page);
      await addServerButton(page).click();
      await page.waitForTimeout(300);

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('text=Add MCP Server')).toBeVisible();
    });

    test('dialog has Server Name field', async ({ page }) => {
      await goToMCP(page);
      await addServerButton(page).click();
      await page.waitForTimeout(500);

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.locator('text=Server Name')).toBeVisible();
      await expect(dialog.locator('input').first()).toBeVisible();
    });

    test('dialog has Server Type selector (stdio/SSE/HTTP)', async ({ page }) => {
      await goToMCP(page);
      await addServerButton(page).click();
      await page.waitForTimeout(300);

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.locator('text=Server Type')).toBeVisible();
      await expect(dialog.locator('button:has-text("stdio")')).toBeVisible();
      await expect(dialog.locator('button:has-text("SSE")')).toBeVisible();
      await expect(dialog.locator('button:has-text("HTTP")')).toBeVisible();
    });

    test('dialog has Command and Arguments fields', async ({ page }) => {
      await goToMCP(page);
      await addServerButton(page).click();
      await page.waitForTimeout(300);

      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.locator('text=Command')).toBeVisible();
      await expect(dialog.locator('text=Arguments')).toBeVisible();
    });

    test('Cancel button closes dialog', async ({ page }) => {
      await goToMCP(page);
      await addServerButton(page).click();
      await page.waitForTimeout(300);

      await page.locator('[role="dialog"] button:has-text("Cancel")').click();
      await page.waitForTimeout(300);
      await expect(page.locator('[role="dialog"]')).toBeHidden();
    });
  });

  test.describe('JSON Configuration Editor', () => {
    test('switching to JSON Config tab shows editor', async ({ page }) => {
      await goToMCP(page);
      await page.locator('button:has-text("JSON Config")').click();
      await page.waitForTimeout(300);

      const textarea = page.locator('textarea').first();
      await expect(textarea).toBeVisible();
    });

    test('JSON Config has Save and Format buttons', async ({ page }) => {
      await goToMCP(page);
      await page.locator('button:has-text("JSON Config")').click();
      await page.waitForTimeout(300);

      await expect(page.locator('button:has-text("Save")')).toBeVisible();
      await expect(page.locator('button:has-text("Format")')).toBeVisible();
    });
  });
});
