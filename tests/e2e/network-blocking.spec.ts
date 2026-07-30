import { FIXTURE_ORIGIN, expect, test } from './fixtures/extension-context.ts';

test('Standard mode blocks the deterministic local ad script', async ({ page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/network`);

  await expect(page.locator('#network-status')).toHaveText('blocked');
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { adLoaded?: boolean }).adLoaded))).toBe(false);
});
