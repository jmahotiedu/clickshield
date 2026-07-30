import {
  ChromeLocalStatisticsStorage,
  StatisticsStore,
  type ChromeStatisticsStorageAreaLike,
  type StatisticsDelta,
} from './statistics-store.ts';
import { isExtensionMessage, type BlockedActionMessage } from '../shared/messages.ts';

interface MessageSenderLike {
  tab?: {
    id?: number;
  };
}

interface ChromeRuntimeLike {
  onMessage: {
    addListener(
      listener: (message: unknown, sender: MessageSenderLike) => boolean | void,
    ): void;
  };
}

interface ChromeTabsLike {
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: { status?: string }) => void): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
}

interface ChromeDeclarativeNetRequestLike {
  setExtensionActionOptions(options: {
    displayActionCountAsBadgeText: boolean;
  }): Promise<void>;
}

interface ChromeApiLike {
  runtime: ChromeRuntimeLike;
  tabs: ChromeTabsLike;
  storage: {
    local: ChromeStatisticsStorageAreaLike;
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

function installServiceWorker(chromeApi: ChromeApiLike): void {
  const statisticsStore = new StatisticsStore(
    new ChromeLocalStatisticsStorage(chromeApi.storage.local),
  );

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

    if (message.type === 'blocked-action') {
      const tabId = getMessageTabId(sender, message.payload.tabId);
      if (tabId === null) {
        return;
      }

      void statisticsStore.record(createBlockedActionDelta(message, tabId, Date.now()));
    }
  });

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void statisticsStore.resetTab(tabId, Date.now());
    }
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    void statisticsStore.removeTab(tabId);
  });
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;

if (chromeApi !== undefined) {
  installServiceWorker(chromeApi);
}
