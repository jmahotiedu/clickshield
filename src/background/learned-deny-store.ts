export const LEARNED_DENY_STORAGE_KEY = 'learnedDenyHosts';
export const LEARNED_DENY_MAX_HOSTS = 500;
export const LEARNED_DENY_RULE_ID_BASE = 100_000;

export interface LearnedDenyStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface LearnedDenyState {
  hosts: string[];
  ruleIds: Record<string, number>;
  nextRuleId: number;
}

export interface DeclarativeNetRequestDynamicLike {
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

function emptyState(): LearnedDenyState {
  return {
    hosts: [],
    ruleIds: {},
    nextRuleId: LEARNED_DENY_RULE_ID_BASE,
  };
}

function cloneState(state: LearnedDenyState): LearnedDenyState {
  return JSON.parse(JSON.stringify(state)) as LearnedDenyState;
}

export function normalizeDenyHostname(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, '');
  if (trimmed.length === 0 || trimmed.length > 253) {
    return null;
  }

  if (trimmed.includes('/') || trimmed.includes(':') || trimmed.includes(' ')) {
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      return host.length > 0 && !host.includes(':') ? host : null;
    } catch {
      return null;
    }
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    // allow localhost-style single labels? reject — ads are FQDNs
    return null;
  }

  return trimmed;
}

export function hostnameFromDestination(destination: string | null): string | null {
  if (destination === null || destination.length === 0) {
    return null;
  }

  try {
    const url = new URL(destination);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return normalizeDenyHostname(url.hostname);
  } catch {
    return normalizeDenyHostname(destination);
  }
}

function hostnameMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function destinationMatchesLearnedHosts(
  destination: string | null,
  hosts: readonly string[],
): boolean {
  const hostname = hostnameFromDestination(destination);
  if (hostname === null) {
    return false;
  }

  return hosts.some((host) => hostnameMatches(hostname, host));
}

export class LearnedDenyStore {
  private readonly storage: LearnedDenyStorageArea;
  private readonly maxHosts: number;
  private state: LearnedDenyState = emptyState();
  private loaded = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(storage: LearnedDenyStorageArea, options: { maxHosts?: number } = {}) {
    this.storage = storage;
    this.maxHosts = options.maxHosts ?? LEARNED_DENY_MAX_HOSTS;
  }

  hosts(): readonly string[] {
    return this.state.hosts;
  }

  isDeniedDestination(destination: string | null): boolean {
    return destinationMatchesLearnedHosts(destination, this.state.hosts);
  }

  async load(): Promise<void> {
    await this.enqueue(async () => {
      const raw = await this.storage.get(LEARNED_DENY_STORAGE_KEY);
      this.state = sanitizeState(raw[LEARNED_DENY_STORAGE_KEY], this.maxHosts);
      this.loaded = true;
    });
  }

  async learnHostname(input: string): Promise<{ learned: boolean; hostname: string | null }> {
    const hostname = normalizeDenyHostname(input);
    if (hostname === null) {
      return { learned: false, hostname: null };
    }

    let learned = false;
    await this.enqueue(async () => {
      if (!this.loaded) {
        const raw = await this.storage.get(LEARNED_DENY_STORAGE_KEY);
        this.state = sanitizeState(raw[LEARNED_DENY_STORAGE_KEY], this.maxHosts);
        this.loaded = true;
      }

      if (this.state.hosts.includes(hostname)) {
        return;
      }

      learned = true;
      const next = cloneState(this.state);
      next.hosts.push(hostname);
      while (next.hosts.length > this.maxHosts) {
        const removed = next.hosts.shift();
        if (removed !== undefined) {
          delete next.ruleIds[removed];
        }
      }
      if (next.ruleIds[hostname] === undefined) {
        next.ruleIds[hostname] = next.nextRuleId;
        next.nextRuleId += 1;
      }
      this.state = next;
      await this.storage.set({ [LEARNED_DENY_STORAGE_KEY]: cloneState(this.state) });
    });

    return { learned, hostname };
  }

  async learnFromDestination(
    destination: string | null,
  ): Promise<{ learned: boolean; hostname: string | null }> {
    const hostname = hostnameFromDestination(destination);
    if (hostname === null) {
      return { learned: false, hostname: null };
    }
    return this.learnHostname(hostname);
  }

  async syncDynamicRules(dnr: DeclarativeNetRequestDynamicLike): Promise<void> {
    await this.enqueue(async () => {
      if (!this.loaded) {
        const raw = await this.storage.get(LEARNED_DENY_STORAGE_KEY);
        this.state = sanitizeState(raw[LEARNED_DENY_STORAGE_KEY], this.maxHosts);
        this.loaded = true;
      }

      const existing = await dnr.getDynamicRules();
      const managedIds = existing
        .map((rule) => rule.id)
        .filter((id) => id >= LEARNED_DENY_RULE_ID_BASE);

      const addRules = this.state.hosts.map((hostname) => {
        const id = this.state.ruleIds[hostname] ?? LEARNED_DENY_RULE_ID_BASE;
        return {
          id,
          priority: 2,
          action: { type: 'block' as const },
          condition: {
            urlFilter: `||${hostname}^`,
            resourceTypes: ['script', 'image', 'sub_frame', 'xmlhttprequest'] as Array<
              'script' | 'image' | 'sub_frame' | 'xmlhttprequest'
            >,
          },
        };
      });

      await dnr.updateDynamicRules({
        removeRuleIds: managedIds,
        addRules,
      });
    });
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.mutationQueue.then(work, work);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function sanitizeState(value: unknown, maxHosts: number): LearnedDenyState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return emptyState();
  }

  const record = value as Record<string, unknown>;
  const hostsRaw = Array.isArray(record.hosts) ? record.hosts : [];
  const hosts: string[] = [];
  for (const entry of hostsRaw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const normalized = normalizeDenyHostname(entry);
    if (normalized !== null && !hosts.includes(normalized)) {
      hosts.push(normalized);
    }
  }

  const trimmed = hosts.slice(-maxHosts);
  const ruleIds: Record<string, number> = {};
  let nextRuleId = LEARNED_DENY_RULE_ID_BASE;
  if (
    typeof record.ruleIds === 'object' &&
    record.ruleIds !== null &&
    !Array.isArray(record.ruleIds)
  ) {
    for (const [host, id] of Object.entries(record.ruleIds as Record<string, unknown>)) {
      if (typeof id === 'number' && Number.isInteger(id) && id >= LEARNED_DENY_RULE_ID_BASE) {
        const normalized = normalizeDenyHostname(host);
        if (normalized !== null && trimmed.includes(normalized)) {
          ruleIds[normalized] = id;
          nextRuleId = Math.max(nextRuleId, id + 1);
        }
      }
    }
  }

  for (const host of trimmed) {
    if (ruleIds[host] === undefined) {
      ruleIds[host] = nextRuleId;
      nextRuleId += 1;
    }
  }

  if (
    typeof record.nextRuleId === 'number' &&
    Number.isInteger(record.nextRuleId) &&
    record.nextRuleId >= nextRuleId
  ) {
    nextRuleId = record.nextRuleId;
  }

  return { hosts: trimmed, ruleIds, nextRuleId };
}

export class InMemoryLearnedDenyStorage implements LearnedDenyStorageArea {
  private values: Record<string, unknown> = {};

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const list = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (key in this.values) {
        result[key] = JSON.parse(JSON.stringify(this.values[key]));
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.values = { ...this.values, ...JSON.parse(JSON.stringify(items)) };
  }
}
