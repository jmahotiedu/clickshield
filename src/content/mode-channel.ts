import {
  ChromeSyncSitePolicyStorage,
  SITE_POLICIES_STORAGE_KEY,
  SitePolicyStore,
  type ChromeStorageAreaLike,
} from '../background/site-policy-store.ts';
import {
  BRIDGE_BOOTSTRAP_MESSAGE,
  BRIDGE_READY_MESSAGE,
  MODE_UPDATE_MESSAGE,
  isPopupAttemptMessage,
  type SanitizedPopupAttempt,
} from '../main-world/event-bridge.ts';
import { BRIDGE_AUTH_TOKEN } from '../shared/bridge-auth.ts';
import {
  clearBlockedPopupTimestamp,
  recordBlockedPopupTimestamp,
} from '../shared/blocked-popup-signal.ts';
import { hasOnlyKeys, isRecord } from '../shared/types.ts';

interface ChromeRuntimeLike {
  sendMessage(message: unknown): Promise<unknown>;
}

interface ChromeStorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

interface ChromeStorageChangedLike {
  addListener(
    listener: (changes: Record<string, ChromeStorageChangeLike>, areaName: string) => void,
  ): void;
  removeListener(
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

interface WindowPostMessageLike {
  location: {
    href: string;
    ancestorOrigins: DOMStringList;
  };
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

function isReadyMessage(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['type']) && value.type === BRIDGE_READY_MESSAGE;
}

export function resolveTopLevelPolicyUrl(target: WindowPostMessageLike): string {
  const { ancestorOrigins } = target.location;
  if (ancestorOrigins.length === 0) {
    return target.location.href;
  }

  return ancestorOrigins.item(ancestorOrigins.length - 1) ?? target.location.href;
}

async function forwardPopupAttempt(
  chromeApi: ChromeApiLike,
  attempt: SanitizedPopupAttempt,
): Promise<void> {
  if (attempt.blocked) {
    recordBlockedPopupTimestamp(attempt.timestamp);
  }

  const messages: unknown[] = [
    {
      type: 'popup-attempt',
      payload: attempt,
    },
  ];

  if (attempt.blocked) {
    messages.push({
      type: 'blocked-action',
      payload: {
        category: 'popup',
        reason: 'no-approved-user-gesture',
      },
    });
  }

  await Promise.all(messages.map((message) => chromeApi.runtime.sendMessage(message)));
}

export function installAuthenticatedModeChannel(
  target: WindowPostMessageLike,
  chromeApi: ChromeApiLike,
): () => void {
  const channel = new MessageChannel();
  const policyStore = new SitePolicyStore(new ChromeSyncSitePolicyStorage(chromeApi.storage.sync));
  let connected = false;
  let disposed = false;
  let requestVersion = 0;

  const publishEffectiveMode = async (): Promise<void> => {
    const version = ++requestVersion;

    try {
      const mode = await policyStore.getMode(resolveTopLevelPolicyUrl(target));
      if (disposed || !connected || version !== requestVersion) {
        return;
      }

      if (mode !== 'strict') {
        clearBlockedPopupTimestamp();
      }

      channel.port1.postMessage({ type: MODE_UPDATE_MESSAGE, mode });
    } catch {
      // Keep the MAIN-world guard pending and fail-closed when policy resolution is unavailable.
    }
  };

  channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isReadyMessage(event.data)) {
      connected = true;
      void publishEffectiveMode();
      return;
    }

    if (isPopupAttemptMessage(event.data)) {
      void forwardPopupAttempt(chromeApi, event.data.attempt).catch(() => undefined);
    }
  });
  channel.port1.start();

  const handleStorageChange = (
    changes: Record<string, ChromeStorageChangeLike>,
    areaName: string,
  ): void => {
    if (areaName === 'sync' && SITE_POLICIES_STORAGE_KEY in changes) {
      void publishEffectiveMode();
    }
  };

  chromeApi.storage.onChanged.addListener(handleStorageChange);
  target.postMessage({ type: BRIDGE_BOOTSTRAP_MESSAGE, token: BRIDGE_AUTH_TOKEN }, '*', [
    channel.port2,
  ]);

  return () => {
    disposed = true;
    chromeApi.storage.onChanged.removeListener(handleStorageChange);
    channel.port1.close();
  };
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeApiLike }).chrome;
if (chromeApi !== undefined && typeof window !== 'undefined') {
  installAuthenticatedModeChannel(window, chromeApi);
}
