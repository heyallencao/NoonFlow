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

test.describe('Input Keyboard Navigation', () => {
  test('generic input wrapper supports Home/End in plugin search', async ({ page }) => {
    await page.goto('/extensions');
    await waitForPageReady(page);
    await ensureWorkspaceReady(page);
    await page.goto('/extensions');
    await waitForPageReady(page);

    const search = page.locator('input[placeholder*="Search"], input[placeholder*="搜索"]').first();
    await expect(search).toBeVisible();

    await search.fill('keyboard navigation');
    await search.evaluate((element) => {
      const inputElement = element as HTMLInputElement;
      inputElement.setSelectionRange(8, 8);
    });

    await search.press('End');
    const endSelection = await search.evaluate((element) => ({
      end: (element as HTMLInputElement).selectionEnd,
      start: (element as HTMLInputElement).selectionStart,
    }));
    expect(endSelection.start).toBe(19);
    expect(endSelection.end).toBe(19);

    await search.press('Home');
    const homeSelection = await search.evaluate((element) => ({
      end: (element as HTMLInputElement).selectionEnd,
      start: (element as HTMLInputElement).selectionStart,
    }));
    expect(homeSelection.start).toBe(0);
    expect(homeSelection.end).toBe(0);
  });
});
