import { FIXTURE_ORIGIN, expect, setSiteMode, test } from './fixtures/extension-context.ts';

test.beforeEach(async ({ context, extensionId }) => {
  await setSiteMode(context, extensionId, 'player.clickshield.test', 'strict');
});

function hasOpenOrdinaryPopup(context: Parameters<typeof test>[0] extends never ? never : never): never {
  throw new Error(String(context));
}

test('Ctrl-click and middle-click preserve legitimate new tabs', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);

  const [ctrlPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#legitimate-link').click({ modifiers: ['Control'] }),
  ]);
  await ctrlPage.waitForLoadState('domcontentloaded');
  await expect(ctrlPage).toHaveURL(`${FIXTURE_ORIGIN}/destination`);
  await ctrlPage.close();

  await page.bringToFront();
  const [middlePage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#legitimate-link').click({ button: 'middle' }),
  ]);
  await middlePage.waitForLoadState('domcontentloaded');
  await expect(middlePage).toHaveURL(`${FIXTURE_ORIGIN}/destination`);
  await middlePage.close();
});

test('Strict mode closes a known-ad pop-under and restores opener focus', async ({
  context,
  page,
}) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);
  await page.bringToFront();

  const popupCreated = context.waitForEvent('page');
  await page.locator('#trigger-popunder').click();
  const popup = await popupCreated;
  const hasOpenAdPage = (): boolean =>
    context
      .pages()
      .some(
        (candidate) => !candidate.isClosed() && candidate.url().includes('ads.clickshield.test'),
      );

  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect.poll(hasOpenAdPage).toBe(false);
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
});

test('page JavaScript cannot forge a mode update', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('clickshield:mode-update', {
        detail: { mode: 'off' },
      }),
    );
  });

  await page.locator('#trigger-ordinary-popup').click();
  await page.waitForTimeout(1_200);

  expect(
    context
      .pages()
      .some(
        (candidate) =>
          !candidate.isClosed() && candidate.url().includes('ordinary.clickshield.test'),
      ),
  ).toBe(false);
});

test('Strict mode protects window.open inside a third-party iframe', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/iframe-popup-host`);

  await page
    .frameLocator('#popup-frame')
    .locator('#trigger-frame-popup')
    .click();
  await page.waitForTimeout(1_200);

  expect(
    context
      .pages()
      .some(
        (candidate) =>
          !candidate.isClosed() && candidate.url().includes('ordinary.clickshield.test'),
      ),
  ).toBe(false);
});

test('authentication-style popup remains open', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);

  const [authPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#auth-link').click(),
  ]);
  await authPage.waitForLoadState('domcontentloaded');

  await expect(authPage).toHaveURL('http://auth.clickshield.test:4173/oauth/authorize');
  expect(authPage.isClosed()).toBe(false);
  await authPage.close();
});
