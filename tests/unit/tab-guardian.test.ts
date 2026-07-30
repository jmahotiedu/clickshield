import { describe, expect, it, vi } from 'vitest';

import {
  TabGuardian,
  type PopupCorrelationContext,
  type PopupCorrelationStore,
  type TabAdapter,
  type TabGuardianOptions,
  type TabSnapshot,
  type WindowAdapter,
} from '../../src/background/tab-guardian.ts';

function tab(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    id: 20,
    windowId: 3,
    openerTabId: 10,
    url: 'https://doubleclick.net/pop',
    active: true,
    ...overrides,
  };
}

function context(overrides: Partial<PopupCorrelationContext> = {}): PopupCorrelationContext {
  return {
    sourceTabId: 10,
    sourceUrl: 'https://player.example/watch',
    destinationUrl: 'https://doubleclick.net/pop',
    timestamp: 1_000,
    approvedGesture: false,
    explicitNewContext: false,
    syntheticEvent: false,
    ...overrides,
  };
}

function setup(
  overrides: {
    enforcement?: 'observe' | 'enforce';
    activeTabId?: number | null;
    removeError?: Error;
    correlation?: PopupCorrelationContext | null;
  } = {},
) {
  const calls: string[] = [];
  const sourceTab: TabSnapshot = {
    id: 10,
    windowId: 3,
    url: 'https://player.example/watch',
    active: false,
  };
  const tabsById = new Map<number, TabSnapshot>([
    [10, sourceTab],
    [20, tab()],
  ]);
  const tabs: TabAdapter = {
    get: vi.fn(async (tabId) => tabsById.get(tabId) ?? null),
    getActiveTabId: vi.fn(async () => overrides.activeTabId ?? 20),
    remove: vi.fn(async (tabId) => {
      calls.push(`remove:${tabId}`);
      if (overrides.removeError !== undefined) {
        throw overrides.removeError;
      }
    }),
    activate: vi.fn(async (tabId) => {
      calls.push(`activate:${tabId}`);
    }),
  };
  const windows: WindowAdapter = {
    focus: vi.fn(async (windowId) => {
      calls.push(`focus:${windowId}`);
    }),
  };
  const correlations: PopupCorrelationStore = {
    consumeRecentAttempt: vi.fn(async () => overrides.correlation ?? context()),
    appendDecision: vi.fn(async () => undefined),
  };
  const onBlocked = vi.fn(async () => undefined);
  const options: TabGuardianOptions = {
    tabs,
    windows,
    correlations,
    getMode: async () => 'strict',
    clock: () => 1_050,
    delay: async () => undefined,
    onBlocked,
  };
  if (overrides.enforcement !== undefined) {
    options.enforcement = overrides.enforcement;
  }
  const guardian = new TabGuardian(options);

  return { guardian, tabs, windows, correlations, onBlocked, calls };
}

describe('tab guardian', () => {
  it('defaults to observe-only and records a block decision without mutating tabs', async () => {
    const { guardian, tabs, correlations } = setup();

    const result = await guardian.handleCreatedTab(tab());

    expect(result.decision.outcome).toBe('block');
    expect(result.closed).toBe(false);
    expect(tabs.remove).not.toHaveBeenCalled();
    expect(correlations.appendDecision).toHaveBeenCalledOnce();
  });

  it('closes a high-confidence blocked tab before restoring origin focus', async () => {
    const { guardian, calls, onBlocked } = setup({ enforcement: 'enforce' });

    const result = await guardian.handleCreatedTab(tab());

    expect(result.closed).toBe(true);
    expect(calls).toEqual(['remove:20', 'activate:10', 'focus:3']);
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it('does not mutate tabs for allow or observe decisions', async () => {
    const allowed = setup({
      enforcement: 'enforce',
      correlation: context({ approvedGesture: true }),
    });
    const observed = setup({
      enforcement: 'enforce',
      correlation: context({ destinationUrl: 'https://news.example/article' }),
    });

    expect((await allowed.guardian.handleCreatedTab(tab())).decision.outcome).toBe('allow');
    expect(
      (await observed.guardian.handleCreatedTab(tab({ url: 'https://news.example/article' })))
        .decision.outcome,
    ).toBe('observe');
    expect(allowed.tabs.remove).not.toHaveBeenCalled();
    expect(observed.tabs.remove).not.toHaveBeenCalled();
  });

  it('does not count or refocus after a failed closure', async () => {
    const { guardian, tabs, windows, onBlocked } = setup({
      enforcement: 'enforce',
      removeError: new Error('tab already closed'),
    });

    const result = await guardian.handleCreatedTab(tab());

    expect(result.closed).toBe(false);
    expect(tabs.activate).not.toHaveBeenCalled();
    expect(windows.focus).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('does not steal focus when the user already selected another tab', async () => {
    const { guardian, tabs, windows } = setup({ enforcement: 'enforce', activeTabId: 30 });

    const result = await guardian.handleCreatedTab(tab());

    expect(result.closed).toBe(true);
    expect(tabs.activate).not.toHaveBeenCalled();
    expect(windows.focus).not.toHaveBeenCalled();
  });

  it('ignores tabs without an opener', async () => {
    const { guardian, tabs, correlations } = setup({ enforcement: 'enforce' });
    const createdTab = tab();
    delete createdTab.openerTabId;

    const result = await guardian.handleCreatedTab(createdTab);

    expect(result.decision.outcome).toBe('observe');
    expect(tabs.remove).not.toHaveBeenCalled();
    expect(correlations.consumeRecentAttempt).not.toHaveBeenCalled();
  });
});
