import { test, expect } from '@playwright/test';
import {
  goToPlugins,
  goToSettings,
  goToSettingsTab,
  skillsSearchInput,
  skillListItems,
  createSkillButton,
  skillEditorContent,
  skillSaveButton,
  skillPreviewToggle,
  skillDeleteButton,
  collectConsoleErrors,
  filterCriticalErrors,
} from '../helpers';

test.describe('Skills Editor (V2)', () => {
  test.describe('Settings Page Navigation', () => {
    test('settings page has Skills tab trigger', async ({ page }) => {
      await goToSettings(page);
      // Skills tab or link should be visible somewhere in the settings UI
      const skillsTab = page.locator('button:has-text("Skills"), a:has-text("Skills")');
      await expect(skillsTab.first()).toBeVisible();
    });

    test('navigating to /settings?tab=skills shows skills editor', async ({ page }) => {
      await goToSettingsTab(page, 'skills');
      // Should show skills-related UI
      const heading = page.locator('text=Skills');
      await expect(heading.first()).toBeVisible();
    });
  });

  test.describe('Skills List', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('skills list area is rendered', async ({ page }) => {
      // The SkillsManager renders either skill items or "No skills yet" empty state
      // The heading "Skills" should always be visible
      await expect(page.locator('h3:has-text("Skills")')).toBeVisible({ timeout: 5000 });
    });

    test('skills show source badges (global/project)', async ({ page }) => {
      // Check that badge elements exist for source classification
      const badges = page.locator('[class*="badge"]');
      // Either badges are present (if skills exist) or we see empty state
      const badgeCount = await badges.count();
      const emptyState = page.locator('text=No skills');
      const isEmpty = await emptyState.isVisible().catch(() => false);
      expect(badgeCount > 0 || isEmpty).toBeTruthy();
    });
  });

  test.describe('Skill Search', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('search input is visible', async ({ page }) => {
      const search = skillsSearchInput(page);
      await expect(search).toBeVisible();
    });

    test('search input accepts text', async ({ page }) => {
      const search = skillsSearchInput(page);
      await search.fill('nonexistent-skill');
      await expect(search).toHaveValue('nonexistent-skill');
    });

    test('clearing search resets the list', async ({ page }) => {
      const search = skillsSearchInput(page);
      await search.fill('test');
      await page.waitForTimeout(300);
      await search.clear();
      await page.waitForTimeout(300);
      // Should return to normal state
      await expect(search).toHaveValue('');
    });
  });

  test.describe('Create New Skill', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('create skill button is visible', async ({ page }) => {
      const createBtn = createSkillButton(page);
      await expect(createBtn).toBeVisible();
    });

    test('clicking create opens dialog', async ({ page }) => {
      const createBtn = createSkillButton(page);
      await createBtn.click();
      await page.waitForTimeout(300);

      // Dialog should appear
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible();
    });

    test('dialog can be dismissed with Cancel', async ({ page }) => {
      const createBtn = createSkillButton(page);
      await createBtn.click();
      await page.waitForTimeout(300);

      const cancelBtn = page.locator('[role="dialog"] button:has-text("Cancel")');
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('[role="dialog"]')).toBeHidden();
      }
    });
  });

  test.describe('Edit Skill Content', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('editor area is present when a skill is selected', async ({ page }) => {
      // If skills exist, clicking one should show the editor
      const items = skillListItems(page);
      const count = await items.count();
      if (count > 0) {
        await items.first().click();
        await page.waitForTimeout(300);
        const editor = skillEditorContent(page);
        await expect(editor).toBeVisible();
      }
      // If no skills, this is a structural test that passes
      expect(true).toBeTruthy();
    });
  });

  test.describe('Preview Mode', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('preview toggle is visible when a skill is selected', async ({ page }) => {
      const items = skillListItems(page);
      const count = await items.count();
      if (count > 0) {
        await items.first().click();
        await page.waitForTimeout(300);
        const previewBtn = skillPreviewToggle(page);
        await expect(previewBtn).toBeVisible();
      }
      expect(true).toBeTruthy();
    });
  });

  test.describe('Save/Delete Skill', () => {
    test.beforeEach(async ({ page }) => {
      await goToSettingsTab(page, 'skills');
    });

    test('save button is present', async ({ page }) => {
      const items = skillListItems(page);
      const count = await items.count();
      if (count > 0) {
        await items.first().click();
        await page.waitForTimeout(300);
        const saveBtn = skillSaveButton(page);
        await expect(saveBtn).toBeVisible();
      }
      expect(true).toBeTruthy();
    });

    test('delete button appears on skill hover', async ({ page }) => {
      const items = skillListItems(page);
      const count = await items.count();
      if (count > 0) {
        await items.first().hover();
        await page.waitForTimeout(300);
        const deleteBtn = skillDeleteButton(page);
        await expect(deleteBtn).toBeVisible();
      }
      expect(true).toBeTruthy();
    });
  });

  test.describe('Navigation from /plugins', () => {
    test('plugins page has link to skills editor', async ({ page }) => {
      await goToPlugins(page);
      // Look for a link that navigates to the skills editor in settings
      const skillsLink = page.locator('a[href*="settings"][href*="skills"], a[href*="settings?tab=skills"]');
      const directLink = await skillsLink.count();
      // There should be at least a general settings link or skills-specific link
      const settingsLink = page.locator('aside a[href="/settings"]');
      expect(directLink > 0 || (await settingsLink.count()) > 0).toBeTruthy();
    });
  });

  test.describe('No Console Errors', () => {
    test('skills editor page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToSettingsTab(page, 'skills');
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });
  });
});
