import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export const FIXTURE_ORIGIN = 'http://player.clickshield.test:4173';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
}

interface ExtensionStorageApi {
  storage: {
    sync: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    session: {
      get(key: string): Promise<Record<string, unknown>>;
    };
  };
}

export const test = base.extend<ExtensionFixtures>({
  context: async (_dependencies, use, testInfo) => {
    const extensionPath = path.resolve('dist');
    const userDataDirectory = testInfo.outputPath('user-data');
    await mkdir(userDataDirectory, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDirectory, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP *.clickshield.test 127.0.0.1,EXCLUDE localhost',
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extensionId = serviceWorker.url().split('/')[2];
    if (extensionId === undefined) {
      throw new Error('Could not resolve the ClickShield extension ID.');
    }

    await use(extensionId);
  },
});

export { expect };

export async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  relativePath = 'popup/popup.html',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

export async function openActionPopup(
  context: BrowserContext,
  extensionId: string,
  activePage: Page,
): Promise<Page> {
  const popupPage = await context.newPage();
  await activePage.bringToFront();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popupPage;
}

export async function setSiteMode(
  context: BrowserContext,
  extensionId: string,
  hostname: string,
  mode: 'off' | 'standard' | 'strict',
): Promise<void> {
  const extensionPage = await openExtensionPage(context, extensionId);
  await extensionPage.evaluate(
    async ({ hostname: requestedHostname, mode: requestedMode }) => {
      const chromeApi = (globalThis as typeof globalThis & { chrome: ExtensionStorageApi }).chrome;
      const result = await chromeApi.storage.sync.get('sitePolicies');
      const current = result.sitePolicies;
      const policies =
        typeof current === 'object' && current !== null && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      policies[requestedHostname] = requestedMode;
      await chromeApi.storage.sync.set({ sitePolicies: policies });
    },
    { hostname, mode },
  );
  await extensionPage.close();
}

export async function readSessionState(
  context: BrowserContext,
  extensionId: string,
): Promise<Record<string, unknown>> {
  const extensionPage = await openExtensionPage(context, extensionId);
  const state = await extensionPage.evaluate(async () => {
    const chromeApi = (globalThis as typeof globalThis & { chrome: ExtensionStorageApi }).chrome;
    return chromeApi.storage.session.get('popupSessionState');
  });
  await extensionPage.close();
  return state;
}
