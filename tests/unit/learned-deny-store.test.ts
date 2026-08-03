import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryLearnedDenyStorage,
  LEARNED_DENY_RULE_ID_BASE,
  LearnedDenyStore,
  destinationMatchesLearnedHosts,
  hostnameFromDestination,
  normalizeDenyHostname,
} from '../../src/background/learned-deny-store.ts';

describe('learned deny normalization', () => {
  it('normalizes hostnames and rejects junk', () => {
    expect(normalizeDenyHostname('Hai8G.COM.')).toBe('hai8g.com');
    expect(normalizeDenyHostname('https://ads.example/path')).toBe('ads.example');
    expect(normalizeDenyHostname('chrome://extensions')).toBeNull();
    expect(normalizeDenyHostname('')).toBeNull();
  });

  it('extracts hostnames from destinations', () => {
    expect(hostnameFromDestination('https://hai8g.com/afu.php')).toBe('hai8g.com');
    expect(hostnameFromDestination('about:blank')).toBeNull();
  });

  it('matches learned hosts with subdomain suffix rules', () => {
    expect(destinationMatchesLearnedHosts('https://a.hai8g.com/x', ['hai8g.com'])).toBe(true);
    expect(destinationMatchesLearnedHosts('https://news.example/', ['hai8g.com'])).toBe(false);
  });
});

describe('LearnedDenyStore', () => {
  it('persists new hosts and skips duplicates', async () => {
    const storage = new InMemoryLearnedDenyStorage();
    const store = new LearnedDenyStore(storage);
    await store.load();

    await expect(store.learnHostname('hai8g.com')).resolves.toEqual({
      learned: true,
      hostname: 'hai8g.com',
    });
    await expect(store.learnHostname('HAI8G.com')).resolves.toEqual({
      learned: false,
      hostname: 'hai8g.com',
    });
    expect(store.hosts()).toEqual(['hai8g.com']);
    expect(store.isDeniedDestination('https://hai8g.com/x')).toBe(true);

    const restarted = new LearnedDenyStore(storage);
    await restarted.load();
    expect(restarted.hosts()).toEqual(['hai8g.com']);
  });

  it('caps host count by dropping the oldest entries', async () => {
    const store = new LearnedDenyStore(new InMemoryLearnedDenyStorage(), { maxHosts: 2 });
    await store.learnHostname('a.example');
    await store.learnHostname('b.example');
    await store.learnHostname('c.example');
    expect(store.hosts()).toEqual(['b.example', 'c.example']);
  });

  it('syncs managed dynamic DNR rules for learned hosts', async () => {
    const store = new LearnedDenyStore(new InMemoryLearnedDenyStorage());
    await store.learnHostname('hai8g.com');

    const dnr = {
      getDynamicRules: vi.fn(async () => [{ id: LEARNED_DENY_RULE_ID_BASE }]),
      updateDynamicRules: vi.fn(async () => undefined),
    };

    await store.syncDynamicRules(dnr);

    expect(dnr.updateDynamicRules).toHaveBeenCalledWith({
      removeRuleIds: [LEARNED_DENY_RULE_ID_BASE],
      addRules: [
        expect.objectContaining({
          id: LEARNED_DENY_RULE_ID_BASE,
          action: { type: 'block' },
          condition: expect.objectContaining({
            urlFilter: '||hai8g.com^',
          }),
        }),
      ],
    });
  });
});
