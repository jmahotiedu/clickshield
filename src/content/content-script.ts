import genericConfiguration from '../../filters/cosmetic/generic.json';
import siteSpecificConfiguration from '../../filters/cosmetic/site-specific.json';
import {
  ChromeSyncSitePolicyStorage,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from '../background/site-policy-store.ts';
import {
  COSMETIC_STYLE_ATTRIBUTE,
  COSMETIC_STYLE_VALUE,
  createCosmeticCss,
  estimateHiddenElements,
  resolveCosmeticSelectors,
  type GenericCosmeticFilters,
  type SiteSpecificCosmeticFilters,
} from './cosmetic-engine.ts';

interface ChromeRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
}

interface ChromeApiLike {
  runtime: ChromeRuntimeLike;
  storage: {
    sync: ChromeStorageAreaLike;
  };
}

const genericFilters = genericConfiguration as unknown as GenericCosmeticFilters;
const siteSpecificFilters = siteSpecificConfiguration as unknown as SiteSpecificCosmeticFilters;

function waitForDocumentReady(): Promise<void> {
  if (document.readyState !== 'loading') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function injectCosmeticStyle(selectors: string[]): void {
  const css = createCosmeticCss(selectors);
  if (css.length === 0) {
    return;
  }

  const style = document.createElement('style');
  style.setAttribute(COSMETIC_STYLE_ATTRIBUTE, COSMETIC_STYLE_VALUE);
  style.textContent = css;
  (document.head ?? document.documentElement).append(style);
}

async function initializeCosmeticFiltering(chromeApi: ChromeApiLike): Promise<void> {
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const mode = await policyStore.getMode(globalThis.location.href);
  const selectors = resolveCosmeticSelectors(
    globalThis.location.hostname,
    mode,
    genericFilters,
    siteSpecificFilters,
  );

  if (selectors.length === 0) {
    return;
  }

  injectCosmeticStyle(selectors);
  await waitForDocumentReady();

  const hiddenElements = estimateHiddenElements(document, selectors);
  if (hiddenElements > 0) {
    await chromeApi.runtime.sendMessage({
      type: 'statistics-update',
      payload: {
        tabId: 0,
        blockedRequests: 0,
        hiddenElements,
      },
    });
  }
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
if (chromeApi !== undefined) {
  void initializeCosmeticFiltering(chromeApi);
}
