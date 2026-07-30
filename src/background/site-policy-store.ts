import { DEFAULT_SITE_MODE, isSiteMode, type SiteMode } from '../shared/settings.ts';

export const SITE_POLICIES_STORAGE_KEY = 'sitePolicies';

export type SitePolicies = Record<string, SiteMode>;

export interface SitePolicyStorage {
  load(): Promise<SitePolicies>;
  save(policies: SitePolicies): Promise<void>;
}

export interface ChromeStorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }
      const value = Number(part);
      return value >= 0 && value <= 255 && String(value) === part.replace(/^0+(?=\d)/, '');
    })
  );
}

function isIpAddress(hostname: string): boolean {
  return isIpv4Address(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'));
}

export function normalizeHostname(input: string): string | null {
  const candidate = input.trim();
  if (candidate.length === 0) {
    return null;
  }

  try {
    const url = /^[a-z][a-z\d+.-]*:/i.test(candidate)
      ? new URL(candidate)
      : new URL(`https://${candidate}`);

    if (!HTTP_PROTOCOLS.has(url.protocol)) {
      return null;
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

export function getPolicyCandidates(hostname: string): string[] {
  if (isIpAddress(hostname) || hostname === 'localhost') {
    return [hostname];
  }

  const labels = hostname.split('.').filter((label) => label.length > 0);
  if (labels.length <= 2) {
    return [hostname];
  }

  const candidates: string[] = [];
  for (let index = 0; index <= labels.length - 2; index += 1) {
    candidates.push(labels.slice(index).join('.'));
  }
  return candidates;
}

export function sanitizeSitePolicies(value: unknown): SitePolicies {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const policies: SitePolicies = {};
  for (const [key, mode] of Object.entries(value)) {
    const hostname = normalizeHostname(key);
    if (hostname !== null && isSiteMode(mode)) {
      policies[hostname] = mode;
    }
  }
  return policies;
}

export function resolveSiteMode(input: string, policies: SitePolicies): SiteMode {
  const hostname = normalizeHostname(input);
  if (hostname === null) {
    return 'off';
  }

  for (const candidate of getPolicyCandidates(hostname)) {
    const mode = policies[candidate];
    if (mode !== undefined) {
      return mode;
    }
  }

  return DEFAULT_SITE_MODE;
}

export class InMemorySitePolicyStorage implements SitePolicyStorage {
  private policies: SitePolicies;

  constructor(initialPolicies: SitePolicies = {}) {
    this.policies = sanitizeSitePolicies(initialPolicies);
  }

  async load(): Promise<SitePolicies> {
    return { ...this.policies };
  }

  async save(policies: SitePolicies): Promise<void> {
    this.policies = sanitizeSitePolicies(policies);
  }
}

export class ChromeSyncSitePolicyStorage implements SitePolicyStorage {
  private readonly storageArea: ChromeStorageAreaLike;

  constructor(storageArea: ChromeStorageAreaLike) {
    this.storageArea = storageArea;
  }

  async load(): Promise<SitePolicies> {
    const result = await this.storageArea.get(SITE_POLICIES_STORAGE_KEY);
    return sanitizeSitePolicies(result[SITE_POLICIES_STORAGE_KEY]);
  }

  async save(policies: SitePolicies): Promise<void> {
    await this.storageArea.set({
      [SITE_POLICIES_STORAGE_KEY]: sanitizeSitePolicies(policies),
    });
  }
}

export class SitePolicyStore {
  private readonly storage: SitePolicyStorage;

  constructor(storage: SitePolicyStorage) {
    this.storage = storage;
  }

  async getMode(input: string): Promise<SiteMode> {
    return resolveSiteMode(input, await this.storage.load());
  }

  async setMode(input: string, mode: SiteMode): Promise<boolean> {
    const hostname = normalizeHostname(input);
    if (hostname === null || !isSiteMode(mode)) {
      return false;
    }

    const policies = await this.storage.load();
    policies[hostname] = mode;
    await this.storage.save(policies);
    return true;
  }

  async clearMode(input: string): Promise<boolean> {
    const hostname = normalizeHostname(input);
    if (hostname === null) {
      return false;
    }

    const policies = await this.storage.load();
    if (!(hostname in policies)) {
      return true;
    }

    delete policies[hostname];
    await this.storage.save(policies);
    return true;
  }
}
