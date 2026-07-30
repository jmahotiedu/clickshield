import { describe, expect, it } from 'vitest';

import {
  InMemoryStatisticsStorage,
  StatisticsStore,
  applyStatisticsDelta,
  createEmptyStatisticsState,
  resetTabStatistics,
} from '../../src/background/statistics-store.ts';

describe('statistics aggregation', () => {
  it('tracks per-tab and lifetime counts independently', () => {
    const state = applyStatisticsDelta(createEmptyStatisticsState(), {
      tabId: 12,
      blockedRequests: 3,
      hiddenElements: 2,
      timestamp: 100,
    });

    expect(state.tabStatistics['12']).toEqual({
      blockedRequests: 3,
      hiddenElements: 2,
      lastUpdated: 100,
    });
    expect(state.lifetimeStatistics).toEqual({
      blockedRequests: 3,
      hiddenElements: 2,
    });
  });

  it('keeps separate counts for separate tabs', () => {
    const first = applyStatisticsDelta(createEmptyStatisticsState(), {
      tabId: 1,
      blockedRequests: 1,
      timestamp: 10,
    });
    const second = applyStatisticsDelta(first, {
      tabId: 2,
      hiddenElements: 4,
      timestamp: 20,
    });

    expect(second.tabStatistics['1']?.blockedRequests).toBe(1);
    expect(second.tabStatistics['2']?.hiddenElements).toBe(4);
    expect(second.lifetimeStatistics).toEqual({
      blockedRequests: 1,
      hiddenElements: 4,
    });
  });

  it('resets a tab without reducing lifetime counts', () => {
    const populated = applyStatisticsDelta(createEmptyStatisticsState(), {
      tabId: 7,
      blockedRequests: 5,
      hiddenElements: 6,
      timestamp: 100,
    });
    const reset = resetTabStatistics(populated, 7, 200);

    expect(reset.tabStatistics['7']).toEqual({
      blockedRequests: 0,
      hiddenElements: 0,
      lastUpdated: 200,
    });
    expect(reset.lifetimeStatistics).toEqual({
      blockedRequests: 5,
      hiddenElements: 6,
    });
  });

  it('bounds diagnostic records and stores no page URLs', () => {
    let state = createEmptyStatisticsState();

    for (let index = 0; index < 5; index += 1) {
      state = applyStatisticsDelta(
        state,
        {
          tabId: 3,
          timestamp: index,
          diagnostic: {
            category: 'cosmetic',
            reason: `selector-batch-${index}`,
          },
        },
        3,
      );
    }

    expect(state.diagnostics).toHaveLength(3);
    expect(state.diagnostics.map((record) => record.reason)).toEqual([
      'selector-batch-2',
      'selector-batch-3',
      'selector-batch-4',
    ]);
    expect(JSON.stringify(state.diagnostics)).not.toContain('http');
  });

  it('rejects negative or fractional deltas', () => {
    expect(() =>
      applyStatisticsDelta(createEmptyStatisticsState(), {
        tabId: 1,
        blockedRequests: -1,
        timestamp: 0,
      }),
    ).toThrow('blockedRequests must be a non-negative integer.');

    expect(() =>
      applyStatisticsDelta(createEmptyStatisticsState(), {
        tabId: 1,
        hiddenElements: 1.5,
        timestamp: 0,
      }),
    ).toThrow('hiddenElements must be a non-negative integer.');
  });
});

describe('statistics store', () => {
  it('persists counts through the storage adapter', async () => {
    const storage = new InMemoryStatisticsStorage();
    const store = new StatisticsStore(storage);

    await store.record({
      tabId: 9,
      blockedRequests: 2,
      hiddenElements: 1,
      timestamp: 50,
    });

    await expect(store.getTab(9)).resolves.toEqual({
      blockedRequests: 2,
      hiddenElements: 1,
      lastUpdated: 50,
    });
    await expect(store.getLifetime()).resolves.toEqual({
      blockedRequests: 2,
      hiddenElements: 1,
    });
  });

  it('serializes concurrent updates without losing increments', async () => {
    const store = new StatisticsStore(new InMemoryStatisticsStorage());

    await Promise.all([
      store.record({ tabId: 4, blockedRequests: 1, timestamp: 1 }),
      store.record({ tabId: 4, blockedRequests: 1, timestamp: 2 }),
      store.record({ tabId: 4, hiddenElements: 2, timestamp: 3 }),
    ]);

    await expect(store.getTab(4)).resolves.toEqual({
      blockedRequests: 2,
      hiddenElements: 2,
      lastUpdated: 3,
    });
  });

  it('resets tab counts when navigation starts', async () => {
    const store = new StatisticsStore(new InMemoryStatisticsStorage());
    await store.record({ tabId: 5, blockedRequests: 4, timestamp: 1 });

    await store.resetTab(5, 2);

    await expect(store.getTab(5)).resolves.toEqual({
      blockedRequests: 0,
      hiddenElements: 0,
      lastUpdated: 2,
    });
    await expect(store.getLifetime()).resolves.toEqual({
      blockedRequests: 4,
      hiddenElements: 0,
    });
  });
});
