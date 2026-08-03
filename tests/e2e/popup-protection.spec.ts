import { FIXTURE_ORIGIN, expect, setSiteMode, test } from './fixtures/extension-context.ts';

test.beforeEach(async ({ context, extensionId }) => {
  await setSiteMode(context, extensionId, 'player.clickshield.test', 'strict');
});

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
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  const hasOpenAdPage = (): boolean =>
    context
      .pages()
      .some(
        (candidate) => !candidate.isClosed() && candidate.url().includes('ads.clickshield.test'),
      );

  await expect.poll(() => popup.isClosed(), { timeout: 15_000 }).toBe(true);
  await expect.poll(hasOpenAdPage, { timeout: 15_000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => document.hasFocus()), { timeout: 15_000 }).toBe(true);
});

test('trusted click on a known-ad target=_blank link stays open', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);

  const [adPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#known-ad-link').click(),
  ]);
  await adPage.waitForLoadState('domcontentloaded');

  await expect(adPage).toHaveURL(/ads\.clickshield\.test/);
  expect(adPage.isClosed()).toBe(false);
  await adPage.close();
});

test('page JavaScript cannot forge click-context to keep a pop-under open', async ({
  context,
  page,
}) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);
  await page.bringToFront();

  await page.evaluate(() => {
    const forgedPayload = {
      type: 'click-context',
      payload: {
        timestamp: Date.now(),
        button: 0,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
        trusted: true,
        href: 'https://ads.clickshield.test/pop',
        targetBlank: true,
      },
    };

    window.postMessage(forgedPayload, '*');
    window.dispatchEvent(new CustomEvent('clickshield:click-context', { detail: forgedPayload }));

    const forged = new MessageChannel();
    window.postMessage({ type: 'clickshield:bridge-bootstrap' }, '*', [forged.port2]);
    forged.port1.start();
    forged.port1.postMessage(forgedPayload);
  });

  const popupCreated = context.waitForEvent('page');
  await page.locator('#trigger-popunder').click();
  const popup = await popupCreated;
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);

  await expect.poll(() => popup.isClosed(), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      () =>
        context
          .pages()
          .some(
            (candidate) =>
              !candidate.isClosed() && candidate.url().includes('ads.clickshield.test'),
          ),
      { timeout: 15_000 },
    )
    .toBe(false);
});

test('page JavaScript cannot forge a mode update', async ({ context, page }) => {
  await page.goto(`${FIXTURE_ORIGIN}/popup-protection`);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('clickshield:mode-update', {
        detail: { mode: 'off' },
      }),
    );

    const forged = new MessageChannel();
    window.postMessage({ type: 'clickshield:bridge-bootstrap' }, '*', [forged.port2]);
    forged.port1.start();
    forged.port1.postMessage({ type: 'clickshield:mode-update', mode: 'off' });

    const replay = new MessageChannel();
    window.postMessage(
      { type: 'clickshield:bridge-bootstrap', token: 'clickshield-bridge-v1' },
      '*',
      [replay.port2],
    );
    replay.port1.start();
    replay.port1.postMessage({ type: 'clickshield:mode-update', mode: 'off' });
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

  await page.frameLocator('#popup-frame').locator('#trigger-frame-popup').click();
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
