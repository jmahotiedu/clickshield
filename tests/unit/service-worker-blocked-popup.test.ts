import { describe, expect, it, vi } from 'vitest';

import { installServiceWorker } from '../../src/background/service-worker.ts';

function createChromeHarness() {
  const messageListeners: Array<
    (message: unknown, sender: { tab?: { id?: number; url?: string } }) => void
  > = [];
  const sentMessages: Array<{ tabId: number; message: unknown }> = [];

  const chromeApi = {
    runtime: {
      onMessage: {
        addListener(
          listener: (message: unknown, sender: { tab?: { id?: number; url?: string } }) => void,
        ): void {
          messageListeners.push(listener);
        },
      },
    },
    tabs: {
      onCreated: { addListener(): void {} },
      onUpdated: { addListener(): void {} },
      onRemoved: { addListener(): void {} },
      async get(): Promise<never> {
        throw new Error('unused');
      },
      async query(): Promise<never[]> {
        return [];
      },
      async remove(): Promise<void> {},
      async update(): Promise<never> {
        throw new Error('unused');
      },
      async sendMessage(tabId: number, message: unknown): Promise<void> {
        sentMessages.push({ tabId, message });
      },
    },
    windows: {
      async update(): Promise<void> {},
    },
    storage: {
      local: {
        async get(): Promise<Record<string, unknown>> {
          return {};
        },
        async set(): Promise<void> {},
      },
      sync: {
        async get(): Promise<Record<string, unknown>> {
          return {};
        },
        async set(): Promise<void> {},
      },
      session: {
        async get(): Promise<Record<string, unknown>> {
          return {};
        },
        async set(): Promise<void> {},
      },
    },
    declarativeNetRequest: {
      async setExtensionActionOptions(): Promise<void> {},
    },
  };

  return {
    chromeApi,
    sentMessages,
    emit(message: unknown, sender: { tab?: { id?: number; url?: string } }): void {
      for (const listener of messageListeners) {
        listener(message, sender);
      }
    },
  };
}

describe('service worker blocked-popup relay', () => {
  it('notifies the source tab when a popup attempt is blocked', async () => {
    const harness = createChromeHarness();
    installServiceWorker(harness.chromeApi as never);

    harness.emit(
      {
        type: 'popup-attempt',
        payload: {
          url: 'https://ads.clickshield.test/pop',
          target: '_blank',
          timestamp: 1_700_000_123,
          blocked: true,
          approvedGesture: false,
          explicitNewContext: false,
          syntheticEvent: false,
        },
      },
      { tab: { id: 42, url: 'https://player.example/watch' } },
    );

    await vi.waitFor(() => {
      expect(harness.sentMessages).toEqual([
        {
          tabId: 42,
          message: {
            type: 'recent-blocked-popup',
            payload: { timestamp: 1_700_000_123 },
          },
        },
      ]);
    });
  });

  it('does not notify when an approved popup attempt is recorded', async () => {
    const harness = createChromeHarness();
    installServiceWorker(harness.chromeApi as never);

    harness.emit(
      {
        type: 'popup-attempt',
        payload: {
          url: 'https://example.com/help',
          target: '_blank',
          timestamp: 99,
          blocked: false,
          approvedGesture: true,
          explicitNewContext: true,
          syntheticEvent: false,
        },
      },
      { tab: { id: 7, url: 'https://player.example/watch' } },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.sentMessages).toEqual([]);
  });
});
