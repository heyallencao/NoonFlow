import { test, expect } from '@playwright/test';
import { waitForPageReady } from '../helpers';

test.describe('Resize Handle Interaction', () => {
  test('right panel handle increases panel width when dragged left', async ({ page }) => {
    await page.goto('/chat/test-session');
    await waitForPageReady(page);

    const panel = page
      .locator('aside')
      .filter({ has: page.getByTestId('right-panel-tools-toggle') });
    await expect(panel).toBeVisible();

    const handle = page.getByTestId('right-panel-resize-handle');
    await expect(handle).toBeVisible();

    const initialBox = await panel.boundingBox();
    const handleBox = await handle.boundingBox();

    expect(initialBox).not.toBeNull();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2 - 60,
      handleBox!.y + handleBox!.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(150);

    const resizedBox = await panel.boundingBox();
    expect(resizedBox).not.toBeNull();
    expect(resizedBox!.width).toBeGreaterThan(initialBox!.width + 20);
  });
});
