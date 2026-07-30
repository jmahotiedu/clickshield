export const TAB_STATISTICS_STORAGE_KEY = 'tabStatistics';
export const LIFETIME_STATISTICS_STORAGE_KEY = 'lifetimeStatistics';
export const DIAGNOSTICS_STORAGE_KEY = 'statisticsDiagnostics';
export const DEFAULT_MAX_DIAGNOSTICS = 50;

export interface TabStatistics {
  blockedRequests: number;
  hiddenElements: number;
  lastUpdated: number;
}

export interface LifetimeStatistics {
  blockedRequests: number;
  hiddenElements: number;
}

export interface StatisticsDiagnostic {
  tabId: number;
  timestamp: number;
  category: string;
  reason: string;
}

export interface StatisticsState {
  tabStatistics: Record<string, TabStatistics>;
  lifetimeStatistics: LifetimeStatistics;
  diagnostics: StatisticsDiagnostic[];
}

export interface StatisticsDelta {
  tabId: number;
  blockedRequests?: number;
  hiddenElements?: number;
  timestamp: number;
  diagnostic?: {
    category: string;
    reason: string;
  };
}

export interface ChromeStatisticsStorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StatisticsStorage {
  read(): Promise<StatisticsState>;
  write(state: StatisticsState): Promise<void>;
}

function cloneState(state: StatisticsState): StatisticsState {
  return {
    tabStatistics: Object.fromEntries(
      Object.entries(state.tabStatistics).map(([tabId, value]) => [tabId, { ...value }]),
    ),
    lifetimeStatistics: { ...state.lifetimeStatistics },
    diagnostics: state.diagnostics.map((record) => ({ ...record })),
  };
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function toTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseTabStatistics(value: unknown): Record<string, TabStatistics> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const parsed: Record<string, TabStatistics> = {};
  for (const [tabId, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    parsed[tabId] = {
      blockedRequests: toNonNegativeInteger(record.blockedRequests),
      hiddenElements: toNonNegativeInteger(record.hiddenElements),
      lastUpdated: toTimestamp(record.lastUpdated),
    };
  }

  return parsed;
}

function parseLifetimeStatistics(value: unknown): LifetimeStatistics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { blockedRequests: 0, hiddenElements: 0 };
  }

  const record = value as Record<string, unknown>;
  return {
    blockedRequests: toNonNegativeInteger(record.blockedRequests),
    hiddenElements: toNonNegativeInteger(record.hiddenElements),
  };
}

function parseDiagnostics(value: unknown): StatisticsDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (
      typeof record.tabId !== 'number' ||
      !Number.isInteger(record.tabId) ||
      record.tabId < 0 ||
      typeof record.timestamp !== 'number' ||
      !Number.isFinite(record.timestamp) ||
      record.timestamp < 0 ||
      typeof record.category !== 'string' ||
      typeof record.reason !== 'string'
    ) {
      return [];
    }

    return [
      {
        tabId: record.tabId,
        timestamp: record.timestamp,
        category: record.category,
        reason: record.reason,
      },
    ];
  });
}

function assertDelta(
  name: 'blockedRequests' | 'hiddenElements',
  value: number | undefined,
): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
}

function assertTabId(tabId: number): void {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error('tabId must be a non-negative integer.');
  }
}

function assertTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error('timestamp must be a non-negative finite number.');
  }
}

export function createEmptyStatisticsState(): StatisticsState {
  return {
    tabStatistics: {},
    lifetimeStatistics: {
      blockedRequests: 0,
      hiddenElements: 0,
    },
    diagnostics: [],
  };
}

export function applyStatisticsDelta(
  state: StatisticsState,
  delta: StatisticsDelta,
  maxDiagnostics = DEFAULT_MAX_DIAGNOSTICS,
): StatisticsState {
  assertTabId(delta.tabId);
  assertTimestamp(delta.timestamp);

  const blockedRequests = assertDelta('blockedRequests', delta.blockedRequests);
  const hiddenElements = assertDelta('hiddenElements', delta.hiddenElements);
  const next = cloneState(state);
  const key = String(delta.tabId);
  const current = next.tabStatistics[key] ?? {
    blockedRequests: 0,
    hiddenElements: 0,
    lastUpdated: delta.timestamp,
  };

  next.tabStatistics[key] = {
    blockedRequests: current.blockedRequests + blockedRequests,
    hiddenElements: current.hiddenElements + hiddenElements,
    lastUpdated: delta.timestamp,
  };
  next.lifetimeStatistics.blockedRequests += blockedRequests;
  next.lifetimeStatistics.hiddenElements += hiddenElements;

  if (delta.diagnostic !== undefined && maxDiagnostics > 0) {
    next.diagnostics.push({
      tabId: delta.tabId,
      timestamp: delta.timestamp,
      category: delta.diagnostic.category,
      reason: delta.diagnostic.reason,
    });
    next.diagnostics = next.diagnostics.slice(-maxDiagnostics);
  }

  return next;
}

export function resetTabStatistics(
  state: StatisticsState,
  tabId: number,
  timestamp: number,
): StatisticsState {
  assertTabId(tabId);
  assertTimestamp(timestamp);

  const next = cloneState(state);
  next.tabStatistics[String(tabId)] = {
    blockedRequests: 0,
    hiddenElements: 0,
    lastUpdated: timestamp,
  };
  return next;
}

export function removeTabStatistics(state: StatisticsState, tabId: number): StatisticsState {
  assertTabId(tabId);

  const next = cloneState(state);
  delete next.tabStatistics[String(tabId)];
  return next;
}

export class ChromeLocalStatisticsStorage implements StatisticsStorage {
  public constructor(private readonly storageArea: ChromeStatisticsStorageAreaLike) {}

  public async read(): Promise<StatisticsState> {
    const result = await this.storageArea.get([
      TAB_STATISTICS_STORAGE_KEY,
      LIFETIME_STATISTICS_STORAGE_KEY,
      DIAGNOSTICS_STORAGE_KEY,
    ]);

    return {
      tabStatistics: parseTabStatistics(result[TAB_STATISTICS_STORAGE_KEY]),
      lifetimeStatistics: parseLifetimeStatistics(result[LIFETIME_STATISTICS_STORAGE_KEY]),
      diagnostics: parseDiagnostics(result[DIAGNOSTICS_STORAGE_KEY]),
    };
  }

  public async write(state: StatisticsState): Promise<void> {
    await this.storageArea.set({
      [TAB_STATISTICS_STORAGE_KEY]: state.tabStatistics,
      [LIFETIME_STATISTICS_STORAGE_KEY]: state.lifetimeStatistics,
      [DIAGNOSTICS_STORAGE_KEY]: state.diagnostics,
    });
  }
}

export class InMemoryStatisticsStorage implements StatisticsStorage {
  private state = createEmptyStatisticsState();

  public async read(): Promise<StatisticsState> {
    return cloneState(this.state);
  }

  public async write(state: StatisticsState): Promise<void> {
    this.state = cloneState(state);
  }
}

export class StatisticsStore {
  private operationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly storage: StatisticsStorage,
    private readonly maxDiagnostics = DEFAULT_MAX_DIAGNOSTICS,
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public record(delta: StatisticsDelta): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.storage.read();
      await this.storage.write(applyStatisticsDelta(current, delta, this.maxDiagnostics));
    });
  }

  public resetTab(tabId: number, timestamp: number): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.storage.read();
      await this.storage.write(resetTabStatistics(current, tabId, timestamp));
    });
  }

  public removeTab(tabId: number): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.storage.read();
      await this.storage.write(removeTabStatistics(current, tabId));
    });
  }

  public getTab(tabId: number): Promise<TabStatistics> {
    return this.enqueue(async () => {
      assertTabId(tabId);
      const state = await this.storage.read();
      return (
        state.tabStatistics[String(tabId)] ?? {
          blockedRequests: 0,
          hiddenElements: 0,
          lastUpdated: 0,
        }
      );
    });
  }

  public getLifetime(): Promise<LifetimeStatistics> {
    return this.enqueue(async () => {
      const state = await this.storage.read();
      return state.lifetimeStatistics;
    });
  }
}
