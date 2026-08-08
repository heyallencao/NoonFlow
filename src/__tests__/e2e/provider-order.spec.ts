import { test, expect } from '@playwright/test';
import { waitForPageReady } from '../helpers';

async function createProvider(request: import('@playwright/test').APIRequestContext, name: string) {
  const response = await request.post('/api/providers', {
    data: {
      name,
      provider_type: 'custom',
      base_url: 'https://example.com/anthropic',
      api_key: `sk-test-${name}`,
      extra_env: '{}',
      notes: 'playwright-temp',
    },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.provider as { id: string; name: string };
}

test.describe('Provider Order', () => {
  test('can reorder connected providers by drag and drop', async ({ page, request }) => {
    const prefix = `playwright-provider-${Date.now()}`;
    const first = await createProvider(request, `${prefix}-a`);
    const second = await createProvider(request, `${prefix}-b`);

    try {
      await page.goto('/settings#providers');
      await waitForPageReady(page);

      await expect(page.locator(`[data-provider-id="${first.id}"]`)).toBeVisible();
      await expect(page.locator(`[data-provider-id="${second.id}"]`)).toBeVisible();

      const getRenderedOrder = async () => {
        return page.locator('[data-provider-id]').evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-provider-id') || '')
        );
      };

      const initialOrder = await getRenderedOrder();
      expect(initialOrder.indexOf(first.id)).toBeGreaterThanOrEqual(0);
      expect(initialOrder.indexOf(second.id)).toBeGreaterThanOrEqual(0);
      expect(initialOrder.indexOf(first.id)).toBeLessThan(initialOrder.indexOf(second.id));

      await page
        .locator(`[data-provider-drag-handle="${second.id}"]`)
        .dragTo(page.locator(`[data-provider-id="${first.id}"]`));

      await expect.poll(async () => {
        const response = await request.get('/api/providers');
        const data = await response.json();
        const ids = (data.providers as Array<{ id: string }>).map((provider) => provider.id);
        return ids.indexOf(second.id) < ids.indexOf(first.id);
      }).toBe(true);

      await page.reload();
      await waitForPageReady(page);

      const refreshedOrder = await getRenderedOrder();
      expect(refreshedOrder.indexOf(second.id)).toBeLessThan(refreshedOrder.indexOf(first.id));
    } finally {
      await request.delete(`/api/providers/${first.id}`).catch(() => undefined);
      await request.delete(`/api/providers/${second.id}`).catch(() => undefined);
    }
  });
});
