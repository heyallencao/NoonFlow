import { test, expect } from '@playwright/test';
import {
  goToChat,
  goToPlugins,
  goToSettings,
  sidebar,
  sidebarToggle,
  themeToggle,
  navLink,
  newChatButton,
  chatInput,
  rightPanel,
  panelCloseButton,
  waitForPageReady,
} from '../helpers';

test.describe('Layout', () => {
  test.describe('Sidebar', () => {
    test('sidebar is visible on desktop', async ({ page }) => {
      await goToChat(page);
      await expect(sidebar(page)).toBeVisible();
      const box = await sidebar(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBe(256);
    });

    test('sidebar has navigation items', async ({ page }) => {
      await goToChat(page);
      await expect(navLink(page, 'Chat')).toBeVisible();
      await expect(navLink(page, 'Plugins')).toBeVisible();
      await expect(navLink(page, 'MCP Servers')).toBeVisible();
      await expect(navLink(page, 'Settings')).toBeVisible();
    });

    test('sidebar has New Chat button', async ({ page }) => {
      await goToChat(page);
      await expect(newChatButton(page)).toBeVisible();
    });

    test('sidebar has Recent Chats section', async ({ page }) => {
      await goToChat(page);
      await expect(page.locator('aside:has-text("Recent Chats")')).toBeVisible();
    });
  });

  test.describe('Sidebar Collapse/Expand', () => {
    test('toggle button is in the header', async ({ page }) => {
      await goToChat(page);
      await expect(sidebarToggle(page)).toBeVisible();
    });

    test('clicking toggle collapses sidebar', async ({ page }) => {
      await goToChat(page);
      await expect(sidebar(page)).toBeVisible();

      await sidebarToggle(page).click();
      await page.waitForTimeout(300);

      const box = await sidebar(page).boundingBox();
      expect(box).toBeNull();
    });

    test('clicking toggle again expands sidebar', async ({ page }) => {
      await goToChat(page);

      // Collapse
      await sidebarToggle(page).click();
      await page.waitForTimeout(300);

      // Expand
      await sidebarToggle(page).click();
      await page.waitForTimeout(300);

      await expect(sidebar(page)).toBeVisible();
      const box = await sidebar(page).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBe(256);
    });

    test('main content expands when sidebar collapses', async ({ page }) => {
      await goToChat(page);

      const mainBefore = await page.locator('main').boundingBox();

      await sidebarToggle(page).click();
      await page.waitForTimeout(300);

      const mainAfter = await page.locator('main').boundingBox();
      expect(mainAfter!.width).toBeGreaterThan(mainBefore!.width);
    });
  });

  test.describe('Theme Switch', () => {
    test('theme toggle button is in the header', async ({ page }) => {
      await goToChat(page);
      await expect(themeToggle(page)).toBeVisible();
    });

    test('clicking toggle switches to dark mode', async ({ page }) => {
      await goToChat(page);

      await expect(page.locator('html')).toHaveClass(/light/);

      await themeToggle(page).click();
      await page.waitForTimeout(300);

      await expect(page.locator('html')).toHaveClass(/dark/);
    });

    test('clicking toggle again switches back to light mode', async ({ page }) => {
      await goToChat(page);

      await themeToggle(page).click();
      await page.waitForTimeout(300);

      await themeToggle(page).click();
      await page.waitForTimeout(300);

      await expect(page.locator('html')).toHaveClass(/light/);
    });

    test('dark mode applies correct color scheme', async ({ page }) => {
      await goToChat(page);
      await themeToggle(page).click();
      await page.waitForTimeout(300);

      await expect(page.locator('html')).toHaveAttribute(
        'style',
        'color-scheme: dark;'
      );
    });
  });

  test.describe('Navigation Menu Highlight', () => {
    test('Chat nav is highlighted on /chat', async ({ page }) => {
      await goToChat(page);
      const chatNav = navLink(page, 'Chat');
      const classes = await chatNav.getAttribute('class');
      expect(classes).toContain('bg-sidebar-accent');
    });

    test('Plugins nav is highlighted on /plugins', async ({ page }) => {
      await goToPlugins(page);
      const pluginsNav = navLink(page, 'Plugins');
      const classes = await pluginsNav.getAttribute('class');
      expect(classes).toContain('bg-sidebar-accent');
    });

    test('Settings nav is highlighted on /settings', async ({ page }) => {
      await goToSettings(page);
      const settingsNav = navLink(page, 'Settings');
      const classes = await settingsNav.getAttribute('class');
      expect(classes).toContain('bg-sidebar-accent');
    });

    test('navigating via sidebar updates highlight', async ({ page }) => {
      await goToChat(page);

      // Navigate to Plugins via sidebar nav
      await page.locator('aside nav a').filter({ hasText: /^Plugins$/ }).click();
      await waitForPageReady(page);

      // Plugins should have the active accent class (not just hover:)
      const pluginsLink = page.locator('aside nav a').filter({ hasText: /^Plugins$/ });
      const pluginsClasses = await pluginsLink.getAttribute('class') || '';
      // Active link has "bg-sidebar-accent text-sidebar-accent-foreground" (without hover: prefix)
      expect(pluginsClasses).toContain('text-sidebar-accent-foreground');

      // Chat should NOT have the active foreground class
      const chatLink = page.locator('aside nav a').filter({ hasText: /^Chat$/ });
      const chatClasses = await chatLink.getAttribute('class') || '';
      expect(chatClasses).not.toContain('text-sidebar-accent-foreground');
    });
  });

  test.describe('Header', () => {
    test('header shows "Chat" title on /chat', async ({ page }) => {
      await goToChat(page);
      await expect(page.locator('header h1:has-text("Chat")')).toBeVisible();
    });

    test('header shows "Plugins" title on /plugins', async ({ page }) => {
      await goToPlugins(page);
      await expect(page.locator('header h1:has-text("Plugins")')).toBeVisible();
    });

    test('header shows "Settings" title on /settings', async ({ page }) => {
      await goToSettings(page);
      await expect(page.locator('header h1:has-text("Settings")')).toBeVisible();
    });

    test('header shows "MCP Servers" title on /plugins/mcp', async ({ page }) => {
      await page.goto('/plugins/mcp');
      await waitForPageReady(page);
      await expect(
        page.locator('header h1:has-text("MCP Servers")')
      ).toBeVisible();
    });
  });

  test.describe('Mobile Responsive', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('sidebar toggle works as hamburger on mobile', async ({ page }) => {
      await goToChat(page);

      // On mobile, sidebar may default to closed or open
      const initialBox = await sidebar(page).boundingBox();
      const startsOpen = initialBox !== null && initialBox.x >= 0;

      // Helper: close sidebar on mobile using the "Close sidebar" button inside the sidebar
      const closeSidebar = async () => {
        const closeBtn = page.locator('aside button:has-text("Close sidebar")');
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        } else {
          // Fallback: click the backdrop overlay
          const backdrop = page.locator('div.fixed.inset-0.bg-black\\/50');
          if (await backdrop.isVisible().catch(() => false)) {
            await backdrop.click({ force: true });
          }
        }
        await page.waitForTimeout(500);
      };

      if (startsOpen) {
        // Close it first
        await closeSidebar();

        const boxAfterClose = await sidebar(page).boundingBox();
        expect(boxAfterClose === null || boxAfterClose.x < 0).toBeTruthy();

        // Reopen it
        await sidebarToggle(page).click();
        await page.waitForTimeout(500);

        const boxAfterOpen = await sidebar(page).boundingBox();
        expect(boxAfterOpen!.x).toBeGreaterThanOrEqual(0);
      } else {
        // Starts closed -- open it
        await sidebarToggle(page).click();
        await page.waitForTimeout(500);

        const boxAfterOpen = await sidebar(page).boundingBox();
        expect(boxAfterOpen!.x).toBeGreaterThanOrEqual(0);

        // Close it using close button (header toggle is behind the sidebar on mobile)
        await closeSidebar();

        const boxAfterClose = await sidebar(page).boundingBox();
        expect(boxAfterClose === null || boxAfterClose.x < 0).toBeTruthy();
      }
    });

    test('mobile overlay backdrop appears when sidebar is open', async ({ page }) => {
      await goToChat(page);

      // Sidebar defaults to open, so overlay should be visible
      // The overlay is a div with onClick={onClose} and class containing bg-black
      const sidebarBox = await sidebar(page).boundingBox();
      if (sidebarBox && sidebarBox.x >= 0) {
        // Sidebar is open -- there should be a backdrop overlay
        // Check that a fixed overlay div exists (sibling of aside in the sidebar component)
        const overlayCount = await page.locator('div.fixed.inset-0').count();
        expect(overlayCount).toBeGreaterThan(0);
      }
    });

    test('chat page renders correctly on mobile', async ({ page }) => {
      await goToChat(page);

      // Close sidebar if open -- click the overlay backdrop
      const backdrop = page.locator('div.fixed.inset-0.bg-black\\/50');
      if (await backdrop.isVisible().catch(() => false)) {
        await backdrop.click({ force: true });
        await page.waitForTimeout(500);
      }

      // Chat input should be visible
      await expect(chatInput(page)).toBeVisible();

      // Header should be visible
      await expect(page.locator('header')).toBeVisible();
    });
  });

  test.describe('Three-Column Layout (V2)', () => {
    test('right panel is visible on /chat/[id]', async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);

      // Three columns: sidebar + main + right panel
      await expect(sidebar(page).first()).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      await expect(rightPanel(page)).toBeVisible();
    });

    test('right panel is hidden on non-chat routes', async ({ page }) => {
      await goToSettings(page);
      await expect(rightPanel(page)).toBeHidden();

      await goToPlugins(page);
      await expect(rightPanel(page)).toBeHidden();
    });

    test('main content adjusts width when panel collapses', async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);

      const mainBefore = await page.locator('main').boundingBox();

      // Collapse the right panel
      await panelCloseButton(page).click();
      await page.waitForTimeout(300);

      const mainAfter = await page.locator('main').boundingBox();
      expect(mainAfter!.width).toBeGreaterThan(mainBefore!.width);
    });
  });
});
