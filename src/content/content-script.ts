import genericConfiguration from '../../filters/cosmetic/generic.json';
import siteSpecificConfiguration from '../../filters/cosmetic/site-specific.json';
import {
  ChromeSyncSitePolicyStorage,
  SITE_POLICIES_STORAGE_KEY,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from '../background/site-policy-store.ts';
import {
  clearBlockedPopupTimestamp,
  getLastBlockedPopupTimestamp,
  recordBlockedPopupTimestamp,
} from '../shared/blocked-popup-signal.ts';
import { isRecentBlockedPopupMessage } from '../shared/messages.ts';
import type { SiteMode } from '../shared/settings.ts';
import {
  COSMETIC_STYLE_ATTRIBUTE,
  COSMETIC_STYLE_VALUE,
  createCosmeticCss,
  resolveCosmeticSelectors,
  type GenericCosmeticFilters,
  type SiteSpecificCosmeticFilters,
} from './cosmetic-engine.ts';
import {
  BatchedMutationProcessor,
  MutationObserverLifecycle,
  type ElementLike,
  type MutationRecordLike,
  type ObserverLike,
} from './mutation-observer.ts';
import { scoreOverlay, type OverlayAssessment } from './overlay-detector.ts';
import {
  OverlayMitigator,
  createOverlaySnapshot,
  type OverlayElementLike,
  type OverlayMitigationAction,
} from './overlay-mitigator.ts';

interface ChromeRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
}

interface ChromeStorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

interface ChromeStorageChangedLike {
  addListener(
    listener: (changes: Record<string, ChromeStorageChangeLike>, areaName: string) => void,
  ): void;
}

interface ChromeApiLike {
  runtime: ChromeRuntimeLike;
  storage: {
    sync: ChromeStorageAreaLike;
    onChanged: ChromeStorageChangedLike;
  };
}

const genericFilters = genericConfiguration as unknown as GenericCosmeticFilters;
const siteSpecificFilters = siteSpecificConfiguration as unknown as SiteSpecificCosmeticFilters;
const countedElements = new WeakSet<Element>();
const overlayMitigator = new OverlayMitigator();

let currentSelectors: string[] = [];
let currentStyle: HTMLStyleElement | null = null;
let currentMode: SiteMode = 'off';
let applicationVersion = 0;

function waitForDocumentReady(): Promise<void> {
  if (document.readyState !== 'loading') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function replaceCosmeticStyle(selectors: string[]): void {
  currentStyle?.remove();
  currentStyle = null;

  const css = createCosmeticCss(selectors);
  if (css.length === 0) {
    return;
  }

  const style = document.createElement('style');
  style.setAttribute(COSMETIC_STYLE_ATTRIBUTE, COSMETIC_STYLE_VALUE);
  style.textContent = css;
  (document.head ?? document.documentElement).append(style);
  currentStyle = style;
}

function matchesAnySelector(element: Element, selectors: string[]): boolean {
  for (const selector of selectors) {
    try {
      if (element.matches(selector)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function countNewMatches(elements: Iterable<ElementLike>, selectors: string[]): number {
  let count = 0;

  for (const element of elements) {
    if (!(element instanceof Element) || countedElements.has(element)) {
      continue;
    }

    if (matchesAnySelector(element, selectors)) {
      countedElements.add(element);
      count += 1;
    }
  }

  return count;
}

function collectInitialMatches(selectors: string[]): Element[] {
  const elements = new Set<Element>();

  for (const selector of selectors) {
    try {
      document.querySelectorAll(selector).forEach((element) => elements.add(element));
    } catch {
      continue;
    }
  }

  return [...elements];
}

function collectInitialOverlayCandidates(maximum = 500): Element[] {
  const selector = [
    'iframe',
    '[style*="position"]',
    '[class*="overlay" i]',
    '[id*="overlay" i]',
    '[class*="pop" i]',
    '[id*="pop" i]',
  ].join(',');
  return [...document.querySelectorAll(selector)].slice(0, maximum);
}

async function reportHiddenElements(
  chromeApi: ChromeApiLike,
  hiddenElements: number,
): Promise<void> {
  if (hiddenElements <= 0) {
    return;
  }

  try {
    await chromeApi.runtime.sendMessage({
      type: 'statistics-update',
      payload: {
        tabId: 0,
        blockedRequests: 0,
        hiddenElements,
      },
    });
  } catch {
    // The page remains filtered even if the service worker is temporarily unavailable.
  }
}

function overlayReason(action: OverlayMitigationAction, assessment: OverlayAssessment): string {
  return `${action}:${assessment.reasons.join('+')}`.slice(0, 256);
}

async function reportOverlayMitigation(
  chromeApi: ChromeApiLike,
  action: OverlayMitigationAction,
  assessment: OverlayAssessment,
): Promise<void> {
  if (action === 'none') {
    return;
  }

  try {
    await chromeApi.runtime.sendMessage({
      type: 'blocked-action',
      payload: {
        category: 'overlay',
        reason: overlayReason(action, assessment),
      },
    });
  } catch {
    // The mitigation remains reversible locally if the worker is unavailable.
  }
}

function processOverlays(chromeApi: ChromeApiLike, elements: Iterable<ElementLike>): void {
  if (currentMode !== 'strict') {
    return;
  }

  const timestamp = Date.now();
  for (const element of elements) {
    if (!(element instanceof Element)) {
      continue;
    }

    const assessment = scoreOverlay(
      createOverlaySnapshot(element, timestamp, getLastBlockedPopupTimestamp()),
    );
    const action = overlayMitigator.mitigate(
      element as unknown as OverlayElementLike,
      assessment,
      currentMode,
    );
    void reportOverlayMitigation(chromeApi, action, assessment);
  }
}

function processElements(chromeApi: ChromeApiLike, elements: ElementLike[]): void {
  void reportHiddenElements(chromeApi, countNewMatches(elements, currentSelectors));
  processOverlays(chromeApi, elements);
}

function createNativeObserver(callback: (records: MutationRecordLike[]) => void): ObserverLike {
  const observer = new MutationObserver((records) => callback(records));

  return {
    observe(target, options): void {
      observer.observe(target as Node, options);
    },
    disconnect(): void {
      observer.disconnect();
    },
  };
}

async function initializeCosmeticFiltering(chromeApi: ChromeApiLike): Promise<void> {
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const processor = new BatchedMutationProcessor(
    (elements) => processElements(chromeApi, elements),
    { delayMs: 50, maxNodes: 500 },
  );
  const lifecycle = new MutationObserverLifecycle(createNativeObserver, (records) => {
    processor.enqueue(records);
  });

  chromeApi.runtime.onMessage.addListener((message) => {
    if (isRecentBlockedPopupMessage(message)) {
      recordBlockedPopupTimestamp(message.payload.timestamp);
    }
  });

  const applyCurrentPolicy = async (): Promise<void> => {
    const version = ++applicationVersion;
    const mode = await policyStore.getMode(globalThis.location.href);
    if (version !== applicationVersion) {
      return;
    }

    processor.disconnect();
    lifecycle.setEnabled(false, document.documentElement);
    currentMode = mode;

    if (mode !== 'strict') {
      overlayMitigator.restoreAll();
      clearBlockedPopupTimestamp();
    }

    currentSelectors = resolveCosmeticSelectors(
      globalThis.location.hostname,
      mode,
      genericFilters,
      siteSpecificFilters,
    );
    replaceCosmeticStyle(currentSelectors);

    const shouldObserve = currentSelectors.length > 0 || mode === 'strict';
    if (!shouldObserve) {
      return;
    }

    await waitForDocumentReady();
    if (version !== applicationVersion) {
      return;
    }

    const initialElements = new Set<Element>(collectInitialMatches(currentSelectors));
    if (mode === 'strict') {
      collectInitialOverlayCandidates().forEach((element) => initialElements.add(element));
    }
    processElements(chromeApi, [...initialElements]);
    lifecycle.setEnabled(true, document.documentElement);
  };

  chromeApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && SITE_POLICIES_STORAGE_KEY in changes) {
      void applyCurrentPolicy();
    }
  });

  await applyCurrentPolicy();
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
if (chromeApi !== undefined) {
  void initializeCosmeticFiltering(chromeApi);
}
