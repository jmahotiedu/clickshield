import {
  BLOCK_CONFIDENCE_THRESHOLD,
  classifyPopup,
  type PopupClassificationEvidence,
} from './popup-classifier.ts';
import type { PopupDecision } from '../shared/decisions.ts';
import type { ClickCorrelationContext } from '../shared/native-click-context.ts';
import {
  clickContextApprovesNavigation,
  clickContextIsExplicitNewTab,
} from '../shared/native-click-context.ts';
import type { SiteMode } from '../shared/settings.ts';

export const TAB_CORRELATION_DELAY_MS = 25;
/** How long to watch an opener tab that started as about:blank / unresolved. */
export const PENDING_POPUP_WATCH_TTL_MS = 15_000;

const KNOWN_AD_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'amazon-adsystem.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
  'ads.clickshield.test',
  // Measured 2026-08-02 on cineby.tech click/pop-under traffic
  'hai8g.com',
  'aliexpress.com',
  'aliexpress-media.com',
  'best.aliexpress.com',
  'tiktokcdn.com',
  'zmaticoo.com',
  'appier.net',
  'adnxs.com',
  'clientgear.com',
  'ymmobi.com',
  'mmstat.com',
  'hyleanmerop.qpon',
  'hellenespitous.cfd',
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
  consumeRecentClickContext(
    sourceTabId: number,
    destinationUrl: string | null,
    now: number,
  ): Promise<ClickCorrelationContext | null>;
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
  isKnownAdDestination?(destination: string | null): boolean;
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

  const refreshed =
    refreshedCreatedTab?.pendingUrl ?? refreshedCreatedTab?.url ?? initialDestination;
  return parseUrl(refreshed) !== null ? refreshed : null;
}

function missingEvidenceDecision(): PopupDecision {
  return {
    outcome: 'observe',
    confidence: 0,
    reasons: ['missing-evidence'],
  };
}

interface PendingPopupWatch {
  tabId: number;
  sourceTabId: number;
  windowId: number;
  createdAt: number;
}

export class TabGuardian {
  private readonly options: Required<
    Pick<TabGuardianOptions, 'delay' | 'enforcement' | 'blockThreshold' | 'onBlocked'>
  > &
    Omit<TabGuardianOptions, 'delay' | 'enforcement' | 'blockThreshold' | 'onBlocked'> & {
      isKnownAdDestination: (destination: string | null) => boolean;
    };
  private readonly pendingWatches = new Map<number, PendingPopupWatch>();

  constructor(options: TabGuardianOptions) {
    this.options = {
      ...options,
      delay: options.delay ?? wait,
      enforcement: options.enforcement ?? 'observe',
      blockThreshold: options.blockThreshold ?? BLOCK_CONFIDENCE_THRESHOLD,
      onBlocked: options.onBlocked ?? (async () => undefined),
      isKnownAdDestination: options.isKnownAdDestination ?? isKnownAdDestination,
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
    const result = await this.classifyAndMaybeClose({
      createdTabId: createdTab.id,
      windowId: createdTab.windowId,
      sourceTabId,
      sourceTab,
      destinationUrl,
      now,
    });

    if (!result.closed && parseUrl(destinationUrl) === null) {
      this.pendingWatches.set(createdTab.id, {
        tabId: createdTab.id,
        sourceTabId,
        windowId: createdTab.windowId,
        createdAt: now,
      });
    } else {
      this.pendingWatches.delete(createdTab.id);
    }

    return result;
  }

  /**
   * Re-evaluate opener tabs that started as about:blank (uBO-style onPopupUpdated).
   * Do not block about:blank itself — wait for an http(s) URL.
   */
  async handleUpdatedTab(
    tabId: number,
    changeInfo: { url?: string },
  ): Promise<TabGuardianResult | null> {
    const watch = this.pendingWatches.get(tabId);
    if (watch === undefined) {
      return null;
    }

    const now = this.options.clock();
    if (now - watch.createdAt > PENDING_POPUP_WATCH_TTL_MS || now < watch.createdAt) {
      this.pendingWatches.delete(tabId);
      return null;
    }

    const candidateUrl = changeInfo.url ?? (await this.options.tabs.get(tabId))?.url ?? null;
    if (parseUrl(candidateUrl) === null) {
      return null;
    }

    this.pendingWatches.delete(tabId);
    const sourceTab = await this.options.tabs.get(watch.sourceTabId);
    return this.classifyAndMaybeClose({
      createdTabId: tabId,
      windowId: watch.windowId,
      sourceTabId: watch.sourceTabId,
      sourceTab,
      destinationUrl: candidateUrl,
      now,
    });
  }

  private async classifyAndMaybeClose(input: {
    createdTabId: number;
    windowId: number;
    sourceTabId: number;
    sourceTab: TabSnapshot | null;
    destinationUrl: string | null;
    now: number;
  }): Promise<TabGuardianResult> {
    const { createdTabId, windowId, sourceTabId, sourceTab, destinationUrl, now } = input;
    const [correlation, clickContext] = await Promise.all([
      this.options.correlations.consumeRecentAttempt(sourceTabId, destinationUrl, now),
      this.options.correlations.consumeRecentClickContext(sourceTabId, destinationUrl, now),
    ]);
    const correlatedDestination =
      destinationUrl ?? correlation?.destinationUrl ?? clickContext?.href ?? null;
    const sourceUrl = sourceTab?.url ?? correlation?.sourceUrl ?? null;
    const mode = sourceUrl === null ? 'off' : await this.options.getMode(sourceUrl);
    const clickApproves =
      clickContext !== null &&
      destinationUrl !== null &&
      clickContextApprovesNavigation(clickContext);
    const evidence: PopupClassificationEvidence = {
      mode,
      sourceUrl,
      destinationUrl: correlatedDestination,
      approvedGesture: correlation?.approvedGesture === true || clickApproves,
      explicitNewContext:
        correlation?.explicitNewContext === true ||
        (clickContext !== null && clickContextIsExplicitNewTab(clickContext)),
      popupTokenValid: false,
      syntheticEvent:
        correlation?.syntheticEvent === true ||
        (clickContext !== null && clickContext.trusted === false),
      knownAdDestination: this.options.isKnownAdDestination(correlatedDestination),
      authenticationFlow: isAuthenticationFlow(correlatedDestination),
      creationDelayMs:
        correlation === null
          ? clickContext === null
            ? null
            : Math.max(0, now - clickContext.timestamp)
          : Math.max(0, now - correlation.timestamp),
    };
    const decision = classifyPopup(evidence);
    let closed = false;

    if (
      this.options.enforcement === 'enforce' &&
      decision.outcome === 'block' &&
      decision.confidence >= this.options.blockThreshold
    ) {
      const activeTabId = await this.options.tabs.getActiveTabId(windowId);

      try {
        await this.options.tabs.remove(createdTabId);
        closed = true;

        if (activeTabId === createdTabId && sourceTab !== null) {
          await this.options.tabs.activate(sourceTabId);
          await this.options.windows.focus(sourceTab.windowId);
        }
      } catch {
        closed = false;
      }
    }

    const entry: PopupDecisionLogEntry = {
      tabId: createdTabId,
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
