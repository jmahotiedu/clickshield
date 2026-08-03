import { isPopupDecision } from '../shared/decisions.ts';
import type { ModifierState } from '../shared/messages.ts';
import type { ClickCorrelationContext } from '../shared/native-click-context.ts';
import type {
  PopupCorrelationContext,
  PopupCorrelationStore,
  PopupDecisionLogEntry,
} from './tab-guardian.ts';

export const SESSION_STATE_STORAGE_KEY = 'popupSessionState';
export const SESSION_STATE_VERSION = 2;
export const POPUP_CONTEXT_TTL_MS = 1_500;
export const MAX_DECISION_LOG_ENTRIES = 50;

export interface SessionStateStorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type { ClickCorrelationContext };

interface SessionState {
  version: typeof SESSION_STATE_VERSION;
  attempts: Record<string, PopupCorrelationContext>;
  clicks: Record<string, ClickCorrelationContext>;
  decisions: PopupDecisionLogEntry[];
}

export interface SessionStateStoreOptions {
  contextTtlMs?: number;
  maxDecisionEntries?: number;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyState(): SessionState {
  return {
    version: SESSION_STATE_VERSION,
    attempts: {},
    clicks: {},
    decisions: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function sanitizeContext(value: unknown): PopupCorrelationContext | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isNonNegativeInteger(value.sourceTabId) ||
    !isStringOrNull(value.sourceUrl) ||
    !isStringOrNull(value.destinationUrl) ||
    !isFiniteTimestamp(value.timestamp) ||
    typeof value.approvedGesture !== 'boolean' ||
    typeof value.explicitNewContext !== 'boolean' ||
    typeof value.syntheticEvent !== 'boolean'
  ) {
    return null;
  }

  return {
    sourceTabId: value.sourceTabId,
    sourceUrl: value.sourceUrl?.slice(0, 2_048) ?? null,
    destinationUrl: value.destinationUrl?.slice(0, 2_048) ?? null,
    timestamp: value.timestamp,
    approvedGesture: value.approvedGesture,
    explicitNewContext: value.explicitNewContext,
    syntheticEvent: value.syntheticEvent,
  };
}

function sanitizeDecisionEntry(value: unknown): PopupDecisionLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isNonNegativeInteger(value.tabId) ||
    !(value.sourceTabId === null || isNonNegativeInteger(value.sourceTabId)) ||
    !isFiniteTimestamp(value.timestamp) ||
    !isStringOrNull(value.destination) ||
    !isPopupDecision(value.decision) ||
    typeof value.closed !== 'boolean'
  ) {
    return null;
  }

  return {
    tabId: value.tabId,
    sourceTabId: value.sourceTabId,
    timestamp: value.timestamp,
    destination: value.destination?.slice(0, 2_048) ?? null,
    decision: {
      outcome: value.decision.outcome,
      confidence: value.decision.confidence,
      reasons: [...value.decision.reasons],
    },
    closed: value.closed,
  };
}

function sanitizeClickContext(value: unknown): ClickCorrelationContext | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isNonNegativeInteger(value.sourceTabId) ||
    !isFiniteTimestamp(value.timestamp) ||
    !(value.button === 0 || value.button === 1 || value.button === 2) ||
    !isRecord(value.modifiers) ||
    typeof value.trusted !== 'boolean' ||
    !isStringOrNull(value.href) ||
    typeof value.targetBlank !== 'boolean'
  ) {
    return null;
  }

  const modifiers = value.modifiers;
  if (
    typeof modifiers.alt !== 'boolean' ||
    typeof modifiers.ctrl !== 'boolean' ||
    typeof modifiers.meta !== 'boolean' ||
    typeof modifiers.shift !== 'boolean'
  ) {
    return null;
  }

  return {
    sourceTabId: value.sourceTabId,
    timestamp: value.timestamp,
    button: value.button,
    modifiers: {
      alt: modifiers.alt,
      ctrl: modifiers.ctrl,
      meta: modifiers.meta,
      shift: modifiers.shift,
    } satisfies ModifierState,
    trusted: value.trusted,
    href: value.href?.slice(0, 2_048) ?? null,
    targetBlank: value.targetBlank,
  };
}

function sanitizeState(value: unknown, maxDecisionEntries: number): SessionState {
  if (!isRecord(value) || value.version !== SESSION_STATE_VERSION) {
    return emptyState();
  }

  const attempts: Record<string, PopupCorrelationContext> = {};
  if (isRecord(value.attempts)) {
    for (const [key, attemptValue] of Object.entries(value.attempts)) {
      const attempt = sanitizeContext(attemptValue);
      if (attempt !== null && String(attempt.sourceTabId) === key) {
        attempts[key] = attempt;
      }
    }
  }

  const clicks: Record<string, ClickCorrelationContext> = {};
  if (isRecord(value.clicks)) {
    for (const [key, clickValue] of Object.entries(value.clicks)) {
      const click = sanitizeClickContext(clickValue);
      if (click !== null && String(click.sourceTabId) === key) {
        clicks[key] = click;
      }
    }
  }

  const decisions = Array.isArray(value.decisions)
    ? value.decisions
        .map(sanitizeDecisionEntry)
        .filter((entry): entry is PopupDecisionLogEntry => entry !== null)
        .slice(-maxDecisionEntries)
    : [];

  return {
    version: SESSION_STATE_VERSION,
    attempts,
    clicks,
    decisions,
  };
}

function comparableUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function destinationsMatch(expected: string | null, actual: string | null): boolean {
  return actual === null || comparableUrl(expected) === comparableUrl(actual);
}

export class InMemorySessionStateStorage implements SessionStateStorageAreaLike {
  private values: Record<string, unknown>;

  constructor(initialValues: Record<string, unknown> = {}) {
    this.values = cloneValue(initialValues);
  }

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: cloneValue(this.values[key]) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.values = {
      ...this.values,
      ...cloneValue(items),
    };
  }
}

export class ChromeSessionStateStorage implements SessionStateStorageAreaLike {
  constructor(private readonly storageArea: SessionStateStorageAreaLike) {}

  async get(key: string): Promise<Record<string, unknown>> {
    return this.storageArea.get(key);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.storageArea.set(items);
  }
}

export class SessionStateStore implements PopupCorrelationStore {
  private readonly contextTtlMs: number;
  private readonly maxDecisionEntries: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: SessionStateStorageAreaLike,
    options: SessionStateStoreOptions = {},
  ) {
    this.contextTtlMs = options.contextTtlMs ?? POPUP_CONTEXT_TTL_MS;
    this.maxDecisionEntries = options.maxDecisionEntries ?? MAX_DECISION_LOG_ENTRIES;
  }

  private async load(): Promise<SessionState> {
    const result = await this.storage.get(SESSION_STATE_STORAGE_KEY);
    return sanitizeState(result[SESSION_STATE_STORAGE_KEY], this.maxDecisionEntries);
  }

  private async save(state: SessionState): Promise<void> {
    await this.storage.set({
      [SESSION_STATE_STORAGE_KEY]: sanitizeState(state, this.maxDecisionEntries),
    });
  }

  private mutate<T>(operation: (state: SessionState) => Promise<T> | T): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      const state = await this.load();
      const value = await operation(state);
      await this.save(state);
      return value;
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async recordAttempt(context: PopupCorrelationContext): Promise<void> {
    const sanitized = sanitizeContext(context);
    if (sanitized === null) {
      return;
    }

    await this.mutate((state) => {
      state.attempts[String(sanitized.sourceTabId)] = sanitized;
    });
  }

  async recordClickContext(context: ClickCorrelationContext): Promise<void> {
    const sanitized = sanitizeClickContext(context);
    if (sanitized === null) {
      return;
    }

    await this.mutate((state) => {
      state.clicks[String(sanitized.sourceTabId)] = sanitized;
    });
  }

  async consumeRecentAttempt(
    sourceTabId: number,
    destinationUrl: string | null,
    now: number,
  ): Promise<PopupCorrelationContext | null> {
    return this.mutate((state) => {
      const key = String(sourceTabId);
      const attempt = state.attempts[key];
      if (attempt === undefined) {
        return null;
      }

      if (now - attempt.timestamp > this.contextTtlMs || now < attempt.timestamp) {
        delete state.attempts[key];
        return null;
      }

      if (!destinationsMatch(attempt.destinationUrl, destinationUrl)) {
        return null;
      }

      delete state.attempts[key];
      return cloneValue(attempt);
    });
  }

  async consumeRecentClickContext(
    sourceTabId: number,
    destinationUrl: string | null,
    now: number,
  ): Promise<ClickCorrelationContext | null> {
    return this.mutate((state) => {
      const key = String(sourceTabId);
      const click = state.clicks[key];
      if (click === undefined) {
        return null;
      }

      if (now - click.timestamp > this.contextTtlMs || now < click.timestamp) {
        delete state.clicks[key];
        return null;
      }

      // Require a known destination before consuming. Matching `actual === null`
      // would burn an approvable click on an unresolved tab URL.
      if (destinationUrl === null || !destinationsMatch(click.href, destinationUrl)) {
        return null;
      }

      delete state.clicks[key];
      return cloneValue(click);
    });
  }

  async appendDecision(entry: PopupDecisionLogEntry): Promise<void> {
    const sanitized = sanitizeDecisionEntry(entry);
    if (sanitized === null) {
      return;
    }

    await this.mutate((state) => {
      state.decisions.push(sanitized);
      state.decisions = state.decisions.slice(-this.maxDecisionEntries);
    });
  }

  async getDecisionLog(): Promise<PopupDecisionLogEntry[]> {
    await this.mutationQueue;
    return cloneValue((await this.load()).decisions);
  }

  async clearDecisionLog(sourceTabId?: number): Promise<void> {
    await this.mutate((state) => {
      state.decisions =
        sourceTabId === undefined
          ? []
          : state.decisions.filter((entry) => entry.sourceTabId !== sourceTabId);
    });
  }

  async clearTab(tabId: number): Promise<void> {
    await this.mutate((state) => {
      delete state.attempts[String(tabId)];
      delete state.clicks[String(tabId)];
    });
  }
}
