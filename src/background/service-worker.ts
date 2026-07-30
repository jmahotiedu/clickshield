import {
  ChromeSessionStateStorage,
  SessionStateStore,
  type SessionStateStorageAreaLike,
} from './session-state.ts';
import {
  ChromeSyncSitePolicyStorage,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from './site-policy-store.ts';
import {
  ChromeLocalStatisticsStorage,
  StatisticsStore,
  type ChromeStatisticsStorageAreaLike,
  type StatisticsDelta,
} from './statistics-store.ts';
import {
  TabGuardian,
  type PopupDecisionLogEntry,
  type TabAdapter,
  type TabSnapshot,
  type WindowAdapter,
} from './tab-guardian.ts';
import { isExtensionMessage, type BlockedActionMessage } from '../shared/messages.ts';

interface MessageSenderLike {
  tab?: {
    id?: number;
    url?: string;
  };
}

interface ChromeRuntimeLike {
  onMessage: {
    addListener(listener: (message: unknown, sender: MessageSenderLike) => boolean | void): void;
  };
}

interface ChromeTabLike {
  id?: number;
  windowId: number;
  openerTabId?: number;
  url?: string;
  pendingUrl?: string;
  active: boolean;
}

interface ChromeTabsLike {
  onCreated: {
    addListener(listener: (tab: ChromeTabLike) => void): void;
  };
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: { status?: string }) => void): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
  get(tabId: number): Promise<ChromeTabLike>;
  query(queryInfo: { active: boolean; windowId: number }): Promise<ChromeTabLike[]>;
  remove(tabId: number): Promise<void>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<ChromeTabLike>;
}

interface ChromeWindowsLike {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
}

interface ChromeDeclarativeNetRequestLike {
  setExtensionActionOptions(options: { displayActionCountAsBadgeText: boolean }): Promise<void>;
}

interface ChromeApiLike {
  runtime: ChromeRuntimeLike;
  tabs: ChromeTabsLike;
  windows: ChromeWindowsLike;
  storage: {
    local: ChromeStatisticsStorageAreaLike;
    sync: ChromeStorageAreaLike;
    session: SessionStateStorageAreaLike;
  };
  declarativeNetRequest: ChromeDeclarativeNetRequestLike;
}

function getMessageTabId(
  sender: MessageSenderLike,
  payloadTabId: number | undefined,
): number | null {
  const tabId = sender.tab?.id ?? payloadTabId;
  return typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function createBlockedActionDelta(
  message: BlockedActionMessage,
  tabId: number,
  timestamp: number,
): StatisticsDelta {
  return {
    tabId,
    blockedRequests: message.payload.category === 'network' ? 1 : 0,
    hiddenElements: message.payload.category === 'cosmetic' ? 1 : 0,
    timestamp,
    diagnostic: {
      category: message.payload.category,
      reason: message.payload.reason,
    },
  };
}

function toTabSnapshot(tab: ChromeTabLike): TabSnapshot | null {
  if (tab.id === undefined || !Number.isInteger(tab.id) || tab.id < 0) {
    return null;
  }

  const snapshot: TabSnapshot = {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
  };
  if (tab.openerTabId !== undefined) {
    snapshot.openerTabId = tab.openerTabId;
  }
  if (tab.url !== undefined) {
    snapshot.url = tab.url;
  }
  if (tab.pendingUrl !== undefined) {
    snapshot.pendingUrl = tab.pendingUrl;
  }
  return snapshot;
}

function createTabAdapter(chromeTabs: ChromeTabsLike): TabAdapter {
  return {
    async get(tabId): Promise<TabSnapshot | null> {
      try {
        return toTabSnapshot(await chromeTabs.get(tabId));
      } catch {
        return null;
      }
    },
    async getActiveTabId(windowId): Promise<number | null> {
      const tabs = await chromeTabs.query({ active: true, windowId });
      const tabId = tabs[0]?.id;
      return tabId === undefined ? null : tabId;
    },
    async remove(tabId): Promise<void> {
      await chromeTabs.remove(tabId);
    },
    async activate(tabId): Promise<void> {
      await chromeTabs.update(tabId, { active: true });
    },
  };
}

function createWindowAdapter(chromeWindows: ChromeWindowsLike): WindowAdapter {
  return {
    async focus(windowId): Promise<void> {
      await chromeWindows.update(windowId, { focused: true });
    },
  };
}

function installServiceWorker(chromeApi: ChromeApiLike): void {
  const statisticsStore = new StatisticsStore(
    new ChromeLocalStatisticsStorage(chromeApi.storage.local),
  );
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const sessionStore = new SessionStateStore(
    new ChromeSessionStateStorage(chromeApi.storage.session),
  );
  const guardian = new TabGuardian({
    tabs: createTabAdapter(chromeApi.tabs),
    windows: createWindowAdapter(chromeApi.windows),
    correlations: sessionStore,
    getMode: (url) => policyStore.getMode(url),
    clock: () => Date.now(),
    enforcement: 'enforce',
    onBlocked: async (entry: PopupDecisionLogEntry) => {
      await statisticsStore.record({
        tabId: entry.sourceTabId ?? entry.tabId,
        blockedRequests: 0,
        hiddenElements: 0,
        timestamp: entry.timestamp,
        diagnostic: {
          category: 'popup',
          reason: entry.decision.reasons.join(','),
        },
      });
    },
  });

  void chromeApi.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: true,
  });

  chromeApi.runtime.onMessage.addListener((message, sender) => {
    if (!isExtensionMessage(message)) {
      return;
    }

    if (message.type === 'statistics-update') {
      const tabId = getMessageTabId(sender, message.payload.tabId);
      if (tabId === null) {
        return;
      }

      void statisticsStore.record({
        tabId,
        blockedRequests: message.payload.blockedRequests,
        hiddenElements: message.payload.hiddenElements,
        timestamp: Date.now(),
      });
      return;
    }

    if (message.type === 'popup-attempt') {
      const sourceTabId = getMessageTabId(sender, undefined);
      if (sourceTabId === null || message.payload.blocked) {
        return;
      }

      void sessionStore.recordAttempt({
        sourceTabId,
        sourceUrl: sender.tab?.url ?? null,
        destinationUrl: message.payload.url,
        timestamp: message.payload.timestamp,
        approvedGesture: message.payload.approvedGesture,
        explicitNewContext: message.payload.explicitNewContext,
        syntheticEvent: message.payload.syntheticEvent,
      });
      return;
    }

    if (message.type === 'blocked-action') {
      const tabId = getMessageTabId(sender, message.payload.tabId);
      if (tabId === null) {
        return;
      }

      void statisticsStore.record(createBlockedActionDelta(message, tabId, Date.now()));
    }
  });

  chromeApi.tabs.onCreated.addListener((tab) => {
    const snapshot = toTabSnapshot(tab);
    if (snapshot !== null) {
      void guardian.handleCreatedTab(snapshot);
    }
  });

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void statisticsStore.resetTab(tabId, Date.now());
    }
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    void Promise.all([statisticsStore.removeTab(tabId), sessionStore.clearTab(tabId)]);
  });
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;

if (chromeApi !== undefined) {
  installServiceWorker(chromeApi);
}
