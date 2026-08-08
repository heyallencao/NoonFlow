import { expect, test, type Page } from '@playwright/test';
import { waitForPageReady } from '../helpers';

async function ensureWorkspaceReady(page: Page) {
  const useLastWorkspace = page.getByRole('button', { name: /使用上次工作区|Use last workspace/i });
  const shouldSelectWorkspace = await useLastWorkspace.first().isVisible().catch(() => false);
  if (!shouldSelectWorkspace) {
    return;
  }

  await useLastWorkspace.first().click();
  await waitForPageReady(page);
}

test.describe('Font Size Controls', () => {
  test('supports keyboard zoom in/out and reset on settings page', async ({ page }) => {
    await page.goto('/settings');
    await waitForPageReady(page);
    await ensureWorkspaceReady(page);
    await page.goto('/settings');
    await waitForPageReady(page);

    await expect(page.getByRole('heading', { name: /Text Size|文字大小/i })).toBeVisible();

    await page.locator('body').click();
    const before = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );

    await page.keyboard.press('Control+=');
    await page.waitForTimeout(120);
    const increased = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(increased).toBeGreaterThan(before + 0.2);

    await page.keyboard.press('Control+-');
    await page.waitForTimeout(120);
    const decreased = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(decreased).toBeLessThan(increased - 0.2);

    await page.keyboard.press('Control+0');
    await page.waitForTimeout(120);
    const reset = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(Math.abs(reset - 17)).toBeLessThan(0.5);
  });
});
