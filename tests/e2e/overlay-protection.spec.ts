import { FIXTURE_ORIGIN, expect, setSiteMode, test } from './fixtures/extension-context.ts';

test('Strict mode neutralizes a transparent overlay and Off restores it', async ({
  context,
  extensionId,
  page,
}) => {
  await setSiteMode(context, extensionId, 'player.clickshield.test', 'strict');
  await page.goto(`${FIXTURE_ORIGIN}/overlay-protection`);

  const overlay = page.locator('#transparent-overlay');
  await expect(overlay).toHaveAttribute('data-clickshield-overlay', 'neutralized');
  await expect
    .poll(() => overlay.evaluate((element) => getComputedStyle(element).pointerEvents))
    .toBe('none');

  await setSiteMode(context, extensionId, 'player.clickshield.test', 'off');

  await expect(overlay).not.toHaveAttribute('data-clickshield-overlay');
  await expect
    .poll(() => overlay.evaluate((element) => getComputedStyle(element).pointerEvents))
    .toBe('auto');
  await expect(page.locator('#real-control')).toBeEnabled();
});
