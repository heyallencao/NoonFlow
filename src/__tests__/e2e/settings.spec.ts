import { test, expect } from '@playwright/test';
import {
  goToSettings,
  goToSettingsTab,
  settingsSaveButton,
  settingsResetButton,
  settingsVisualTab,
  settingsJsonTab,
  collectConsoleErrors,
  filterCriticalErrors,
  expectPageLoadTime,
} from '../helpers';

test.describe('Settings Page', () => {
  test.describe('Page Rendering', () => {
    test('settings page loads within 3 seconds', async ({ page }) => {
      await expectPageLoadTime(page, '/settings');
    });

    test('settings page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToSettings(page);
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });

    test('page title and description visible', async ({ page }) => {
      await goToSettings(page);
      await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
      await expect(
        page.locator('text=Manage your Claude CLI settings')
      ).toBeVisible();
    });
  });

  test.describe('Read Current Settings', () => {
    test('Visual Editor tab is selected by default', async ({ page }) => {
      await goToSettings(page);
      await expect(settingsVisualTab(page)).toBeVisible();
    });

    test('Permissions section is visible', async ({ page }) => {
      await goToSettings(page);
      await expect(page.locator('label:has-text("Permissions")')).toBeVisible();
      await expect(
        page.locator('text=Configure permission settings for Claude CLI')
      ).toBeVisible();
    });

    test('Environment Variables section is visible', async ({ page }) => {
      await goToSettings(page);
      await expect(page.locator('label:has-text("Environment Variables")')).toBeVisible();
      await expect(
        page.locator('text=Environment variables passed to Claude')
      ).toBeVisible();
    });
  });

  test.describe('Form Mode Edit', () => {
    test('Save Changes button is visible', async ({ page }) => {
      await goToSettings(page);
      await expect(settingsSaveButton(page)).toBeVisible();
    });

    test('Reset button is visible', async ({ page }) => {
      await goToSettings(page);
      await expect(settingsResetButton(page)).toBeVisible();
    });

    test('permissions textarea is editable', async ({ page }) => {
      await goToSettings(page);
      const textareas = page.locator('textarea');
      const permissionsTextarea = textareas.first();
      await expect(permissionsTextarea).toBeVisible();
      await expect(permissionsTextarea).toBeEditable();
    });

    test('environment variables textarea shows current values', async ({ page }) => {
      await goToSettings(page);
      const textareas = page.locator('textarea');
      const envTextarea = textareas.nth(1);
      await expect(envTextarea).toBeVisible();
      const value = await envTextarea.inputValue();
      expect(value).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');
    });
  });

  test.describe('JSON Mode Edit', () => {
    test('switch to JSON editor mode', async ({ page }) => {
      await goToSettings(page);
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);

      const textarea = page.locator('textarea').first();
      await expect(textarea).toBeVisible();
    });

    test('JSON editor contains valid JSON', async ({ page }) => {
      await goToSettings(page);
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);

      const textarea = page.locator('textarea').first();
      const content = await textarea.inputValue();
      expect(() => JSON.parse(content)).not.toThrow();
    });

    test('JSON contains env settings', async ({ page }) => {
      await goToSettings(page);
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);

      const textarea = page.locator('textarea').first();
      const content = await textarea.inputValue();
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('env');
    });

    test('JSON mode has Save JSON button', async ({ page }) => {
      await goToSettings(page);
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);

      await expect(page.locator('button:has-text("Save JSON")')).toBeVisible();
    });

    test('JSON mode has Format button', async ({ page }) => {
      await goToSettings(page);
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);

      await expect(page.locator('button:has-text("Format")')).toBeVisible();
    });
  });

  test.describe('Mode Switch', () => {
    test('toggle between Visual and JSON modes', async ({ page }) => {
      await goToSettings(page);

      // Switch to JSON
      await settingsJsonTab(page).click();
      await page.waitForTimeout(300);
      await expect(page.locator('button:has-text("Save JSON")')).toBeVisible();

      // Switch back to Visual
      await settingsVisualTab(page).click();
      await page.waitForTimeout(300);
      await expect(page.locator('button:has-text("Save Changes")')).toBeVisible();
    });

    test('Editor mode toggle has both options', async ({ page }) => {
      await goToSettings(page);
      await expect(settingsVisualTab(page)).toBeVisible();
      await expect(settingsJsonTab(page)).toBeVisible();
    });
  });

  test.describe('Save Settings', () => {
    test('Save Changes button is visible and disabled when no changes', async ({ page }) => {
      await goToSettings(page);
      const saveBtn = settingsSaveButton(page);
      await expect(saveBtn).toBeVisible();
      // Should be disabled when there are no unsaved changes
      await expect(saveBtn).toBeDisabled();
    });

    test('Save Changes button enables after making a change', async ({ page }) => {
      await goToSettings(page);
      // Make a change in the permissions textarea
      const textareas = page.locator('textarea');
      const permissionsTextarea = textareas.first();
      await permissionsTextarea.fill('{"allow": ["read"]}');
      await page.waitForTimeout(300);
      // Save button should now be enabled
      const saveBtn = settingsSaveButton(page);
      await expect(saveBtn).toBeEnabled();
    });
  });

  test.describe('Reset Settings', () => {
    test('Reset button is visible and disabled when no changes', async ({ page }) => {
      await goToSettings(page);
      const resetBtn = settingsResetButton(page);
      await expect(resetBtn).toBeVisible();
      // Should be disabled when there are no unsaved changes
      await expect(resetBtn).toBeDisabled();
    });

    test('Reset button enables after making a change', async ({ page }) => {
      await goToSettings(page);
      // Make a change
      const textareas = page.locator('textarea');
      await textareas.first().fill('{"allow": ["write"]}');
      await page.waitForTimeout(300);
      // Reset should be enabled
      const resetBtn = settingsResetButton(page);
      await expect(resetBtn).toBeEnabled();
    });
  });

  test.describe('Settings Navigation (V2)', () => {
    test('settings page has Skills tab or link', async ({ page }) => {
      await goToSettings(page);
      // V2 adds a Skills tab/link to the settings page
      const skillsTab = page.locator('button:has-text("Skills"), a:has-text("Skills")');
      await expect(skillsTab.first()).toBeVisible();
    });

    test('navigating to /settings?tab=skills loads skills editor', async ({ page }) => {
      await goToSettingsTab(page, 'skills');
      // Skills heading or content area should be visible
      const heading = page.locator('text=Skills');
      await expect(heading.first()).toBeVisible();
    });

    test('settings?tab=skills has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToSettingsTab(page, 'skills');
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });
  });
});
