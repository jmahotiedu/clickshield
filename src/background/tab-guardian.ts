import {
  BLOCK_CONFIDENCE_THRESHOLD,
  classifyPopup,
  type PopupClassificationEvidence,
} from './popup-classifier.ts';
import type { PopupDecision } from '../shared/decisions.ts';
import type { SiteMode } from '../shared/settings.ts';

export const TAB_CORRELATION_DELAY_MS = 25;

const KNOWN_AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'amazon-adsystem.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
  'ads.clickshield.test',
] as const;

export interface TabSnapshot {
  id: number;
  windowId: number;
  openerTabId?: number;
  url?: string;
  pendingUrl?: string;
  active?: boolean;
}

export interface TabAdapter {
  get(tabId: number): Promise<TabSnapshot | null>;
  getActiveTabId(windowId: number): Promise<number | null>;
  remove(tabId: number): Promise<void>;
  activate(tabId: number): Promise<void>;
}

export interface WindowAdapter {
  focus(windowId: number): Promise<void>;
}

export interface PopupCorrelationContext {
  sourceTabId: number;
  sourceUrl: string | null;
  destinationUrl: string | null;
  timestamp: number;
  approvedGesture: boolean;
  explicitNewContext: boolean;
  syntheticEvent: boolean;
}

export interface PopupDecisionLogEntry {
  tabId: number;
  sourceTabId: number | null;
  timestamp: number;
  destination: string | null;
  decision: PopupDecision;
  closed: boolean;
}

export interface PopupCorrelationStore {
  consumeRecentAttempt(
    sourceTabId: number,
    destinationUrl: string | null,
    now: number,
  ): Promise<PopupCorrelationContext | null>;
  appendDecision(entry: PopupDecisionLogEntry): Promise<void>;
}

export interface TabGuardianOptions {
  tabs: TabAdapter;
  windows: WindowAdapter;
  correlations: PopupCorrelationStore;
  getMode(url: string): Promise<SiteMode>;
  clock(): number;
  delay?(milliseconds: number): Promise<void>;
  enforcement?: 'observe' | 'enforce';
  blockThreshold?: number;
  onBlocked?(entry: PopupDecisionLogEntry): Promise<void>;
}

export interface TabGuardianResult {
  decision: PopupDecision;
  closed: boolean;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseUrl(value: string | null): URL | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function hostnameMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function isKnownAdDestination(value: string | null): boolean {
  const url = parseUrl(value);
  return url !== null && KNOWN_AD_HOSTS.some((hostname) => hostnameMatches(url.hostname, hostname));
}

export function isAuthenticationFlow(value: string | null): boolean {
  const url = parseUrl(value);
  if (url === null) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  return (
    hostname.startsWith('login.') ||
    hostname.startsWith('auth.') ||
    hostname.startsWith('accounts.') ||
    /\/(?:oauth|authorize|login|signin|sign-in|sso)(?:\/|$)/.test(path)
  );
}

function sanitizeDestination(value: string | null): string | null {
  const url = parseUrl(value);
  return url === null ? null : `${url.origin}${url.pathname}`.slice(0, 2_048);
}

function selectDestination(
  initialDestination: string | null,
  refreshedCreatedTab: TabSnapshot | null,
): string | null {
  if (parseUrl(initialDestination) !== null) {
    return initialDestination;
  }

  return refreshedCreatedTab?.pendingUrl ?? refreshedCreatedTab?.url ?? initialDestination;
}

function missingEvidenceDecision(): PopupDecision {
  return {
    outcome: 'observe',
    confidence: 0,
    reasons: ['missing-evidence'],
  };
}

export class TabGuardian {
  private readonly options: Required<
    Pick<TabGuardianOptions, 'delay' | 'enforcement' | 'blockThreshold' | 'onBlocked'>
  > &
    Omit<TabGuardianOptions, 'delay' | 'enforcement' | 'blockThreshold' | 'onBlocked'>;

  constructor(options: TabGuardianOptions) {
    this.options = {
      ...options,
      delay: options.delay ?? wait,
      enforcement: options.enforcement ?? 'observe',
      blockThreshold: options.blockThreshold ?? BLOCK_CONFIDENCE_THRESHOLD,
      onBlocked: options.onBlocked ?? (async () => undefined),
    };
  }

  async handleCreatedTab(createdTab: TabSnapshot): Promise<TabGuardianResult> {
    const now = this.options.clock();
    const sourceTabId = createdTab.openerTabId ?? null;
    const initialDestination = createdTab.pendingUrl ?? createdTab.url ?? null;

    if (sourceTabId === null) {
      const decision = missingEvidenceDecision();
      await this.options.correlations.appendDecision({
        tabId: createdTab.id,
        sourceTabId: null,
        timestamp: now,
        destination: sanitizeDestination(initialDestination),
        decision,
        closed: false,
      });
      return { decision, closed: false };
    }

    await this.options.delay(TAB_CORRELATION_DELAY_MS);

    const [sourceTab, refreshedCreatedTab] = await Promise.all([
      this.options.tabs.get(sourceTabId),
      this.options.tabs.get(createdTab.id),
    ]);
    const destinationUrl = selectDestination(initialDestination, refreshedCreatedTab);
    const correlation = await this.options.correlations.consumeRecentAttempt(
      sourceTabId,
      destinationUrl,
      now,
    );
    const correlatedDestination = destinationUrl ?? correlation?.destinationUrl ?? null;
    const sourceUrl = sourceTab?.url ?? correlation?.sourceUrl ?? null;
    const mode = sourceUrl === null ? 'off' : await this.options.getMode(sourceUrl);
    const evidence: PopupClassificationEvidence = {
      mode,
      sourceUrl,
      destinationUrl: correlatedDestination,
      approvedGesture: correlation?.approvedGesture ?? false,
      explicitNewContext: correlation?.explicitNewContext ?? false,
      popupTokenValid: false,
      syntheticEvent: correlation?.syntheticEvent ?? false,
      knownAdDestination: isKnownAdDestination(correlatedDestination),
      authenticationFlow: isAuthenticationFlow(correlatedDestination),
      creationDelayMs: correlation === null ? null : Math.max(0, now - correlation.timestamp),
    };
    const decision = classifyPopup(evidence);
    let closed = false;

    if (
      this.options.enforcement === 'enforce' &&
      decision.outcome === 'block' &&
      decision.confidence >= this.options.blockThreshold
    ) {
      const activeTabId = await this.options.tabs.getActiveTabId(createdTab.windowId);

      try {
        await this.options.tabs.remove(createdTab.id);
        closed = true;

        if (activeTabId === createdTab.id && sourceTab !== null) {
          await this.options.tabs.activate(sourceTabId);
          await this.options.windows.focus(sourceTab.windowId);
        }
      } catch {
        closed = false;
      }
    }

    const entry: PopupDecisionLogEntry = {
      tabId: createdTab.id,
      sourceTabId,
      timestamp: now,
      destination: sanitizeDestination(correlatedDestination),
      decision,
      closed,
    };
    await this.options.correlations.appendDecision(entry);

    if (closed) {
      await this.options.onBlocked(entry);
    }

    return { decision, closed };
  }
}
