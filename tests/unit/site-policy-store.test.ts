import { describe, expect, it } from 'vitest';

import {
  getPolicyCandidates,
  InMemorySitePolicyStorage,
  normalizeHostname,
  resolveSiteMode,
  SitePolicyStore,
} from '../../src/background/site-policy-store.ts';

describe('site policy resolution', () => {
  it('uses an exact hostname mode', () => {
    expect(resolveSiteMode('https://video.example.com/watch', { 'video.example.com': 'strict' })).toBe(
      'strict',
    );
  });

  it('inherits a parent-domain mode', () => {
    expect(resolveSiteMode('https://player.example.com/watch', { 'example.com': 'off' })).toBe(
      'off',
    );
  });

  it('prefers a more-specific subdomain override', () => {
    expect(
      resolveSiteMode('https://player.example.com/watch', {
        'example.com': 'off',
        'player.example.com': 'strict',
      }),
    ).toBe('strict');
  });

  it('defaults supported pages to Standard mode', () => {
    expect(resolveSiteMode('https://example.com', {})).toBe('standard');
  });

  it('fails closed for invalid and browser-internal URLs', () => {
    expect(resolveSiteMode('not a valid host /', {})).toBe('off');
    expect(resolveSiteMode('chrome://extensions', {})).toBe('off');
    expect(resolveSiteMode('about:blank', {})).toBe('off');
  });

  it('treats IP addresses as exact hosts', () => {
    expect(getPolicyCandidates('127.0.0.1')).toEqual(['127.0.0.1']);
    expect(resolveSiteMode('http://127.0.0.1:8080', { '127.0.0.1': 'strict' })).toBe(
      'strict',
    );
    expect(resolveSiteMode('http://127.0.0.2:8080', { '127.0.0.1': 'strict' })).toBe(
      'standard',
    );
  });

  it('normalizes hostnames without weakening subdomain boundaries', () => {
    expect(normalizeHostname('HTTPS://Player.Example.COM./watch')).toBe('player.example.com');
    expect(getPolicyCandidates('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
    ]);
  });
});

describe('SitePolicyStore', () => {
  it('persists, resolves, and clears exact site modes through an injected storage adapter', async () => {
    const storage = new InMemorySitePolicyStorage();
    const store = new SitePolicyStore(storage);

    await expect(store.setMode('https://player.example.com', 'strict')).resolves.toBe(true);
    await expect(store.getMode('https://player.example.com/watch')).resolves.toBe('strict');
    await expect(store.clearMode('player.example.com')).resolves.toBe(true);
    await expect(store.getMode('https://player.example.com/watch')).resolves.toBe('standard');
  });

  it('does not persist unsupported inputs', async () => {
    const store = new SitePolicyStore(new InMemorySitePolicyStorage());

    await expect(store.setMode('chrome://settings', 'strict')).resolves.toBe(false);
    await expect(store.getMode('chrome://settings')).resolves.toBe('off');
  });
});
