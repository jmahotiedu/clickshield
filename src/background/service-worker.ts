import { LearnedDenyStore } from './learned-deny-store.ts';
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
  isKnownAdDestination,
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
    addListener(
      listener: (
        message: unknown,
        sender: MessageSenderLike,
        sendResponse: (response: unknown) => void,
      ) => boolean | void,
    ): void;
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
    addListener(
      listener: (tabId: number, changeInfo: { status?: string; url?: string }) => void,
    ): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
  get(tabId: number): Promise<ChromeTabLike>;
  query(queryInfo: { active: boolean; windowId: number }): Promise<ChromeTabLike[]>;
  remove(tabId: number): Promise<void>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<ChromeTabLike>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface ChromeWindowsLike {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
}

interface ChromeDeclarativeNetRequestLike {
  setExtensionActionOptions(options: { displayActionCountAsBadgeText: boolean }): Promise<void>;
  getDynamicRules(): Promise<Array<{ id: number }>>;
  updateDynamicRules(options: {
    removeRuleIds?: number[];
    addRules?: Array<{
      id: number;
      priority: number;
      action: { type: 'block' };
      condition: {
        urlFilter: string;
        resourceTypes: Array<'script' | 'image' | 'sub_frame' | 'xmlhttprequest'>;
      };
    }>;
  }): Promise<void>;
}

interface ChromeWebNavigationLike {
  onCreatedNavigationTarget: {
    addListener(
      listener: (details: { tabId: number; sourceTabId: number; url: string }) => void,
    ): void;
  };
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
  webNavigation: ChromeWebNavigationLike;
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

export function installServiceWorker(chromeApi: ChromeApiLike): void {
  const statisticsStore = new StatisticsStore(
    new ChromeLocalStatisticsStorage(chromeApi.storage.local),
  );
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  const sessionStore = new SessionStateStore(
    new ChromeSessionStateStorage(chromeApi.storage.session),
  );
  const learnedDenyStore = new LearnedDenyStore(chromeApi.storage.local);

  const syncLearnedRules = async (): Promise<void> => {
    try {
      await learnedDenyStore.syncDynamicRules(chromeApi.declarativeNetRequest);
    } catch {
      // Dynamic rule sync can fail transiently; classification still uses in-memory hosts.
    }
  };

  const learnDestination = async (destination: string | null): Promise<void> => {
    const result = await learnedDenyStore.learnFromDestination(destination);
    if (result.learned) {
      await syncLearnedRules();
    }
  };

  const guardian = new TabGuardian({
    tabs: createTabAdapter(chromeApi.tabs),
    windows: createWindowAdapter(chromeApi.windows),
    correlations: sessionStore,
    getMode: (url) => policyStore.getMode(url),
    clock: () => Date.now(),
    enforcement: 'enforce',
    isKnownAdDestination: (destination) =>
      isKnownAdDestination(destination) || learnedDenyStore.isDeniedDestination(destination),
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
      await learnDestination(entry.destination);
    },
  });

  void learnedDenyStore.load().then(() => syncLearnedRules());

  void chromeApi.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: true,
  });

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      return;
    }

    if (message.type === 'learn-deny-host') {
      void (async () => {
        const result = await learnedDenyStore.learnHostname(message.payload.hostname);
        if (result.learned) {
          await syncLearnedRules();
        }

        let closed = false;
        if (message.payload.closeTab === true && typeof message.payload.tabId === 'number') {
          try {
            await chromeApi.tabs.remove(message.payload.tabId);
            closed = true;
          } catch {
            closed = false;
          }
        }

        sendResponse({
          ok: result.hostname !== null,
          learned: result.learned,
          hostname: result.hostname,
          closed,
        });
      })();
      return true;
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
      if (sourceTabId === null) {
        return;
      }

      if (message.payload.blocked) {
        void chromeApi.tabs
          .sendMessage(sourceTabId, {
            type: 'recent-blocked-popup',
            payload: { timestamp: message.payload.timestamp },
          })
          .catch(() => undefined);
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

    if (message.type === 'click-context') {
      const sourceTabId = getMessageTabId(sender, undefined);
      if (sourceTabId === null) {
        return;
      }

      void sessionStore.recordClickContext({
        sourceTabId,
        timestamp: message.payload.timestamp,
        button: message.payload.button,
        modifiers: message.payload.modifiers,
        trusted: message.payload.trusted,
        href: message.payload.href,
        targetBlank: message.payload.targetBlank,
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

  // Pop-unders often omit tab.openerTabId (noopener). webNavigation still reports the source.
  const navigationSources = new Map<number, { sourceTabId: number; url: string; seenAt: number }>();
  const evaluateTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const evaluateNewTab = (tabId: number): void => {
    const existing = evaluateTimers.get(tabId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    evaluateTimers.set(
      tabId,
      setTimeout(() => {
        evaluateTimers.delete(tabId);
        void (async () => {
          try {
            const tab = await chromeApi.tabs.get(tabId);
            const snapshot = toTabSnapshot(tab);
            if (snapshot === null) {
              return;
            }

            const hint = navigationSources.get(tabId);
            if (snapshot.openerTabId === undefined && hint !== undefined) {
              snapshot.openerTabId = hint.sourceTabId;
            }
            if (
              (snapshot.url === undefined || snapshot.url === 'about:blank') &&
              hint !== undefined &&
              hint.url.length > 0 &&
              hint.url !== 'about:blank'
            ) {
              snapshot.pendingUrl = hint.url;
            }

            await guardian.handleCreatedTab(snapshot);
          } catch {
            // Tab may already be gone.
          }
        })();
      }, 120),
    );
  };

  chromeApi.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    navigationSources.set(details.tabId, {
      sourceTabId: details.sourceTabId,
      url: details.url,
      seenAt: Date.now(),
    });
    evaluateNewTab(details.tabId);
  });

  chromeApi.tabs.onCreated.addListener((tab) => {
    if (typeof tab.id === 'number') {
      evaluateNewTab(tab.id);
    }
  });

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void statisticsStore.resetTab(tabId, Date.now());
    }

    if (typeof changeInfo.url === 'string' && changeInfo.url.length > 0) {
      const hint = navigationSources.get(tabId);
      if (hint !== undefined) {
        navigationSources.set(tabId, { ...hint, url: changeInfo.url });
      }
      void guardian.handleUpdatedTab(tabId, { url: changeInfo.url });
    }
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    navigationSources.delete(tabId);
    const timer = evaluateTimers.get(tabId);
    if (timer !== undefined) {
      clearTimeout(timer);
      evaluateTimers.delete(tabId);
    }
    void Promise.all([statisticsStore.removeTab(tabId), sessionStore.clearTab(tabId)]);
  });
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;

if (chromeApi !== undefined) {
  installServiceWorker(chromeApi);
}
