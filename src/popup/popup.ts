import {
  ChromeSyncSitePolicyStorage,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from '../background/site-policy-store.ts';
import { SessionStateStore } from '../background/session-state.ts';
import { TAB_STATISTICS_STORAGE_KEY } from '../background/statistics-store.ts';
import { isSiteMode, type SiteMode } from '../shared/settings.ts';
import {
  createDiagnosticsViewModel,
  type PopupDiagnosticItem,
  type PopupDiagnosticsViewModel,
} from './diagnostics.ts';
import { createPopupViewModel, type PopupStatistics } from './view-model.ts';

interface BrowserTab {
  id?: number;
  url?: string;
}

interface ChromeTabsLike {
  query(queryInfo: { active: true; currentWindow: true }): Promise<BrowserTab[]>;
}

interface ChromeDeclarativeNetRequestLike {
  getMatchedRules(filter: { tabId: number }): Promise<{
    rulesMatchedInfo: unknown[];
  }>;
}

interface ChromeApiLike {
  tabs: ChromeTabsLike;
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    sync: ChromeStorageAreaLike;
    local: ChromeStorageAreaLike;
    session: ChromeStorageAreaLike;
  };
  declarativeNetRequest: ChromeDeclarativeNetRequestLike;
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

async function readMatchedNetworkRules(
  declarativeNetRequest: ChromeDeclarativeNetRequestLike,
  tabId: number | undefined,
): Promise<number> {
  if (tabId === undefined) {
    return 0;
  }

  try {
    const result = await declarativeNetRequest.getMatchedRules({ tabId });
    return Array.isArray(result.rulesMatchedInfo) ? result.rulesMatchedInfo.length : 0;
  } catch {
    return 0;
  }
}

function renderMode(mode: SiteMode): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (radio !== null) {
    radio.checked = true;
  }
}

function createDiagnosticElement(item: PopupDiagnosticItem): HTMLLIElement {
  const listItem = document.createElement('li');
  listItem.className = 'diagnostic-item';

  const heading = document.createElement('p');
  heading.className = 'diagnostic-heading';
  heading.textContent = `${item.outcomeLabel}: ${item.destination}`;

  const metadata = document.createElement('p');
  metadata.className = 'diagnostic-meta';
  const time = new Date(item.timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  metadata.textContent = `${item.confidence}% confidence · ${item.closed ? 'Tab closed' : 'No tab mutation'} · ${time}`;

  const reasons = document.createElement('ul');
  reasons.className = 'diagnostic-reasons';
  for (const reason of item.reasons) {
    const reasonItem = document.createElement('li');
    reasonItem.textContent = reason;
    reasons.append(reasonItem);
  }

  listItem.append(heading, metadata, reasons);
  return listItem;
}

function renderDiagnostics(viewModel: PopupDiagnosticsViewModel): void {
  const count = getRequiredElement<HTMLElement>('diagnostics-count');
  const empty = getRequiredElement<HTMLParagraphElement>('diagnostics-empty');
  const list = getRequiredElement<HTMLOListElement>('diagnostics-list');
  const clear = getRequiredElement<HTMLButtonElement>('clear-diagnostics');

  count.textContent = String(viewModel.total);
  empty.hidden = viewModel.items.length > 0;
  clear.disabled = viewModel.total === 0;
  list.replaceChildren(...viewModel.items.map(createDiagnosticElement));
}

async function initializePopup(chromeApi: ChromeApiLike): Promise<void> {
  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const sessionStore = new SessionStateStore(chromeApi.storage.session);
  const requestedUrl = activeTab?.url;
  const mode = requestedUrl === undefined ? 'off' : await policyStore.getMode(requestedUrl);
  const [statistics, matchedNetworkRules, decisions] = await Promise.all([
    readStatistics(chromeApi.storage.local, activeTab?.id),
    readMatchedNetworkRules(chromeApi.declarativeNetRequest, activeTab?.id),
    sessionStore.getDecisionLog(),
  ]);
  const viewModel = createPopupViewModel({
    url: requestedUrl,
    mode,
    statistics,
    matchedNetworkRules,
  });
  const diagnosticsViewModel =
    activeTab?.id === undefined
      ? { total: 0, items: [] }
      : createDiagnosticsViewModel(decisions, activeTab.id);

  const currentSite = getRequiredElement<HTMLParagraphElement>('current-site');
  const controls = getRequiredElement<HTMLFieldSetElement>('mode-controls');
  const blockedRequests = getRequiredElement<HTMLElement>('blocked-requests');
  const hiddenElements = getRequiredElement<HTMLElement>('hidden-elements');
  const strictDescription = getRequiredElement<HTMLParagraphElement>('strict-description');
  const clearDiagnostics = getRequiredElement<HTMLButtonElement>('clear-diagnostics');
  const blockThisSite = getRequiredElement<HTMLButtonElement>('block-this-site');
  const status = getRequiredElement<HTMLParagraphElement>('status');

  currentSite.textContent = viewModel.hostname;
  controls.disabled = !viewModel.supported;
  blockThisSite.disabled = !viewModel.supported || viewModel.hostname.length === 0;
  blockedRequests.textContent = String(viewModel.blockedRequests);
  hiddenElements.textContent = String(viewModel.hiddenElements);
  strictDescription.textContent = viewModel.strictDescription;
  renderMode(viewModel.mode);
  renderDiagnostics(diagnosticsViewModel);

  blockThisSite.addEventListener('click', async () => {
    if (!viewModel.supported || viewModel.hostname.length === 0) {
      return;
    }

    blockThisSite.disabled = true;
    status.textContent = 'Adding to deny list…';

    try {
      const response = (await chromeApi.runtime.sendMessage({
        type: 'learn-deny-host',
        payload: {
          hostname: viewModel.hostname,
          tabId: activeTab?.id,
          closeTab: true,
        },
      })) as
        { ok?: boolean; learned?: boolean; hostname?: string | null; closed?: boolean } | undefined;

      if (response?.ok !== true || typeof response.hostname !== 'string') {
        status.textContent = 'Could not block this site.';
        blockThisSite.disabled = false;
        return;
      }

      status.textContent = response.learned
        ? `Denied ${response.hostname}${response.closed ? ' and closed this tab.' : '.'}`
        : `${response.hostname} was already denied${response.closed ? '; closed this tab.' : '.'}`;
    } catch {
      status.textContent = 'Could not block this site.';
      blockThisSite.disabled = false;
    }
  });

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
      status.textContent = saved
        ? `Protection set to ${target.value}.`
        : 'This page is unsupported.';
    } catch {
      status.textContent = 'Could not save the protection mode.';
      renderMode(viewModel.mode);
    } finally {
      controls.disabled = !viewModel.supported;
    }
  });

  clearDiagnostics.addEventListener('click', async () => {
    if (activeTab?.id === undefined) {
      return;
    }

    clearDiagnostics.disabled = true;
    status.textContent = 'Clearing diagnostics…';

    try {
      await sessionStore.clearDecisionLog(activeTab.id);
      renderDiagnostics({ total: 0, items: [] });
      status.textContent = 'Diagnostics cleared. Site settings were not changed.';
    } catch {
      clearDiagnostics.disabled = false;
      status.textContent = 'Could not clear diagnostics.';
    }
  });
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
if (chromeApi === undefined) {
  getRequiredElement<HTMLParagraphElement>('status').textContent =
    'Extension APIs are unavailable.';
} else {
  void initializePopup(chromeApi).catch(() => {
    getRequiredElement<HTMLParagraphElement>('status').textContent =
      'Could not load ClickShield settings.';
  });
}
