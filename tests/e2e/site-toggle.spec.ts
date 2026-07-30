import {
  FIXTURE_ORIGIN,
  expect,
  openActionPopup,
  test,
} from './fixtures/extension-context.ts';

test('popup mode controls update cosmetic protection for the active site', async ({
  context,
  extensionId,
  page,
}) => {
  await page.goto(`${FIXTURE_ORIGIN}/site-toggle`);
  await expect(page.locator('#fixture-ad')).toBeHidden();

  const popup = await openActionPopup(context, extensionId, page);
  await expect(popup.locator('#current-site')).toHaveText('player.clickshield.test');
  await expect(popup.getByLabel('Standard')).toBeChecked();

  await popup.getByLabel('Off').check();
  await expect(popup.locator('#status')).toContainText('Protection set to off');
  await expect(page.locator('#fixture-ad')).toBeVisible();

  await popup.getByLabel('Strict').check();
  await expect(popup.locator('#status')).toContainText('Protection set to strict');
  await expect(page.locator('#fixture-ad')).toBeHidden();
});
