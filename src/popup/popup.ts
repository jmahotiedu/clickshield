import {
  ChromeSyncSitePolicyStorage,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from '../background/site-policy-store.ts';
import { isSiteMode, type SiteMode } from '../shared/settings.ts';
import { createPopupViewModel, type PopupStatistics } from './view-model.ts';

const TAB_STATISTICS_STORAGE_KEY = 'tabStatistics';

interface BrowserTab {
  id?: number;
  url?: string;
}

interface ChromeTabsLike {
  query(queryInfo: { active: true; currentWindow: true }): Promise<BrowserTab[]>;
}

interface ChromeApiLike {
  tabs: ChromeTabsLike;
  storage: {
    sync: ChromeStorageAreaLike;
    local: ChromeStorageAreaLike;
  };
}

interface TabStatisticsMap {
  [tabId: string]: Partial<PopupStatistics> | undefined;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return element as T;
}

async function readStatistics(
  storageArea: ChromeStorageAreaLike,
  tabId: number | undefined,
): Promise<Partial<PopupStatistics>> {
  if (tabId === undefined) {
    return {};
  }

  const result = await storageArea.get(TAB_STATISTICS_STORAGE_KEY);
  const value = result[TAB_STATISTICS_STORAGE_KEY];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const statistics = (value as TabStatisticsMap)[String(tabId)];
  return statistics ?? {};
}

function renderMode(mode: SiteMode): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (radio !== null) {
    radio.checked = true;
  }
}

async function initializePopup(chromeApi: ChromeApiLike): Promise<void> {
  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const requestedUrl = activeTab?.url;
  const mode = requestedUrl === undefined ? 'off' : await policyStore.getMode(requestedUrl);
  const statistics = await readStatistics(chromeApi.storage.local, activeTab?.id);
  const viewModel = createPopupViewModel({
    url: requestedUrl,
    mode,
    statistics,
  });

  const currentSite = getRequiredElement<HTMLParagraphElement>('current-site');
  const controls = getRequiredElement<HTMLFieldSetElement>('mode-controls');
  const blockedRequests = getRequiredElement<HTMLElement>('blocked-requests');
  const hiddenElements = getRequiredElement<HTMLElement>('hidden-elements');
  const strictDescription = getRequiredElement<HTMLParagraphElement>('strict-description');
  const status = getRequiredElement<HTMLParagraphElement>('status');

  currentSite.textContent = viewModel.hostname;
  controls.disabled = !viewModel.supported;
  blockedRequests.textContent = String(viewModel.blockedRequests);
  hiddenElements.textContent = String(viewModel.hiddenElements);
  strictDescription.textContent = viewModel.strictDescription;
  renderMode(viewModel.mode);

  controls.addEventListener('change', async (event) => {
    const target = event.target;
    if (
      !viewModel.supported ||
      !(target instanceof HTMLInputElement) ||
      target.name !== 'mode' ||
      !isSiteMode(target.value)
    ) {
      return;
    }

    controls.disabled = true;
    status.textContent = 'Saving…';

    try {
      const saved = await policyStore.setMode(viewModel.hostname, target.value);
      status.textContent = saved ? `Protection set to ${target.value}.` : 'This page is unsupported.';
    } catch {
      status.textContent = 'Could not save the protection mode.';
      renderMode(viewModel.mode);
    } finally {
      controls.disabled = !viewModel.supported;
    }
  });
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
if (chromeApi === undefined) {
  getRequiredElement<HTMLParagraphElement>('status').textContent = 'Extension APIs are unavailable.';
} else {
  void initializePopup(chromeApi).catch(() => {
    getRequiredElement<HTMLParagraphElement>('status').textContent =
      'Could not load ClickShield settings.';
  });
}
