import { listenForModeUpdates, publishPopupAttempt } from './event-bridge.ts';
import { PopupTokenStore } from './popup-token-store.ts';
import {
  installTrustedGestureTracker,
  type ApprovedPopupGesture,
} from './trusted-click-tracker.ts';
import type { SanitizedPopupAttempt } from './event-bridge.ts';
import type { SiteMode } from '../shared/settings.ts';

export type WindowOpenLike<TResult> = (
  this: unknown,
  url?: string | URL,
  target?: string,
  features?: string,
) => TResult;

export interface GuardedWindowOpenOptions {
  getMode(): SiteMode;
  consumeGesture(): ApprovedPopupGesture | null;
  publishAttempt(attempt: SanitizedPopupAttempt): void;
  clock(): number;
  baseUrl(): string;
}

function sanitizeTarget(target: string | undefined): string | null {
  if (target === undefined || target.length === 0) {
    return null;
  }

  return target.slice(0, 64);
}

function sanitizeUrl(url: string | URL | undefined, baseUrl: string): string {
  const rawUrl = url === undefined ? 'about:blank' : String(url);

  try {
    const parsed = new URL(rawUrl, baseUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname}`;
    }

    return `${parsed.protocol}${parsed.pathname}`.slice(0, 2_048);
  } catch {
    return 'unsupported:';
  }
}

export function sanitizePopupAttempt(
  url: string | URL | undefined,
  target: string | undefined,
  timestamp: number,
  baseUrl: string,
  blocked: boolean,
  gesture: ApprovedPopupGesture | null,
): SanitizedPopupAttempt {
  return {
    url: sanitizeUrl(url, baseUrl),
    target: sanitizeTarget(target),
    timestamp,
    blocked,
    approvedGesture: gesture !== null,
    explicitNewContext: gesture?.explicitNewContext ?? false,
    syntheticEvent: false,
  };
}

export function createGuardedWindowOpen<TResult>(
  originalOpen: WindowOpenLike<TResult>,
  options: GuardedWindowOpenOptions,
): WindowOpenLike<TResult | null> {
  return function guardedWindowOpen(
    this: unknown,
    ...args: [url?: string | URL, target?: string, features?: string]
  ): TResult | null {
    let blocked: boolean;

    try {
      const mode = options.getMode();
      const gesture = mode === 'strict' ? options.consumeGesture() : null;
      blocked = mode === 'strict' && gesture === null;
      options.publishAttempt(
        sanitizePopupAttempt(
          args[0],
          args[1],
          options.clock(),
          options.baseUrl(),
          blocked,
          gesture,
        ),
      );
    } catch {
      return originalOpen.apply(this, args);
    }

    if (blocked) {
      return null;
    }

    return originalOpen.apply(this, args);
  };
}

if (typeof window !== 'undefined') {
  const tokenStore = new PopupTokenStore<ApprovedPopupGesture>(() => performance.now(), 750);
  let currentMode: SiteMode = 'standard';

  listenForModeUpdates(window, (mode) => {
    currentMode = mode;
    if (mode !== 'strict') {
      tokenStore.clear();
    }
  });
  installTrustedGestureTracker(window, tokenStore);

  const originalOpen = window.open;
  window.open = createGuardedWindowOpen(originalOpen, {
    getMode: () => currentMode,
    consumeGesture: () => tokenStore.consume(),
    publishAttempt: (attempt) => publishPopupAttempt(window, attempt),
    clock: () => Date.now(),
    baseUrl: () => window.location.href,
  }) as typeof window.open;
}
