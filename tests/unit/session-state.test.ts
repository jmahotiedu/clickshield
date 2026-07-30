import { describe, expect, it } from 'vitest';

import {
  InMemorySessionStateStorage,
  POPUP_CONTEXT_TTL_MS,
  SESSION_STATE_STORAGE_KEY,
  SessionStateStore,
} from '../../src/background/session-state.ts';
import type {
  PopupCorrelationContext,
  PopupDecisionLogEntry,
} from '../../src/background/tab-guardian.ts';

function context(overrides: Partial<PopupCorrelationContext> = {}): PopupCorrelationContext {
  return {
    sourceTabId: 10,
    sourceUrl: 'https://player.example/watch',
    destinationUrl: 'https://doubleclick.net/pop',
    timestamp: 1_000,
    approvedGesture: true,
    explicitNewContext: false,
    syntheticEvent: false,
    ...overrides,
  };
}

function decision(index: number): PopupDecisionLogEntry {
  return {
    tabId: 20 + index,
    sourceTabId: 10,
    timestamp: 2_000 + index,
    destination: 'https://doubleclick.net/pop',
    decision: {
      outcome: 'observe',
      confidence: 40,
      reasons: ['cross-site-destination'],
    },
    closed: false,
  };
}

describe('session popup correlation state', () => {
  it('recovers a recent attempt after a service-worker restart', async () => {
    const storage = new InMemorySessionStateStorage();
    const firstWorker = new SessionStateStore(storage);
    await firstWorker.recordAttempt(context());

    const restartedWorker = new SessionStateStore(storage);

    await expect(
      restartedWorker.consumeRecentAttempt(10, 'https://doubleclick.net/pop', 1_050),
    ).resolves.toEqual(context());
  });

  it('consumes an attempt only once', async () => {
    const store = new SessionStateStore(new InMemorySessionStateStorage());
    await store.recordAttempt(context());

    expect(await store.consumeRecentAttempt(10, null, 1_050)).toEqual(context());
    expect(await store.consumeRecentAttempt(10, null, 1_060)).toBeNull();
  });

  it('expires stale attempts', async () => {
    const store = new SessionStateStore(new InMemorySessionStateStorage());
    await store.recordAttempt(context());

    await expect(
      store.consumeRecentAttempt(10, null, 1_000 + POPUP_CONTEXT_TTL_MS + 1),
    ).resolves.toBeNull();
  });

  it('does not consume a recent attempt for a different destination', async () => {
    const store = new SessionStateStore(new InMemorySessionStateStorage());
    await store.recordAttempt(context());

    expect(await store.consumeRecentAttempt(10, 'https://news.example/article', 1_050)).toBeNull();
    expect(await store.consumeRecentAttempt(10, 'https://doubleclick.net/pop', 1_060)).toEqual(
      context(),
    );
  });

  it('clears transient state when the source tab closes', async () => {
    const store = new SessionStateStore(new InMemorySessionStateStorage());
    await store.recordAttempt(context());

    await store.clearTab(10);

    await expect(store.consumeRecentAttempt(10, null, 1_050)).resolves.toBeNull();
  });

  it('ignores unsupported stored versions', async () => {
    const storage = new InMemorySessionStateStorage({
      [SESSION_STATE_STORAGE_KEY]: {
        version: 999,
        attempts: { 10: context() },
        decisions: [],
      },
    });
    const store = new SessionStateStore(storage);

    await expect(store.consumeRecentAttempt(10, null, 1_050)).resolves.toBeNull();
  });

  it('never persists authorization tokens', async () => {
    const storage = new InMemorySessionStateStorage();
    const store = new SessionStateStore(storage);
    await store.recordAttempt(context());

    const raw = JSON.stringify(await storage.get(SESSION_STATE_STORAGE_KEY));

    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
  });

  it('bounds the decision log', async () => {
    const store = new SessionStateStore(new InMemorySessionStateStorage(), {
      maxDecisionEntries: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      await store.appendDecision(decision(index));
    }

    await expect(store.getDecisionLog()).resolves.toEqual([decision(2), decision(3), decision(4)]);
  });
});
