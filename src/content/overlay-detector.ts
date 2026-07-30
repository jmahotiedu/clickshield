export const LARGE_VIEWPORT_COVERAGE = 0.65;
export const HIGH_Z_INDEX = 1_000;
export const NEAR_TRANSPARENT_OPACITY = 0.08;
export const RECENT_BLOCKED_POPUP_MS = 1_500;
export const OVERLAY_MITIGATION_THRESHOLD = 70;
export const MINIMUM_MITIGATION_SIGNALS = 4;

export type OverlayPosition = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky' | 'other';
export type OverlayRecommendation = 'ignore' | 'observe' | 'mitigate';
export type OverlayReason =
  | 'positioned-over-content'
  | 'large-viewport-coverage'
  | 'high-z-index'
  | 'near-transparent'
  | 'pointer-interception'
  | 'no-meaningful-content'
  | 'suspicious-iframe-source'
  | 'recent-blocked-popup'
  | 'legitimate-dialog'
  | 'legitimate-ui'
  | 'meaningful-content'
  | 'interactive-controls';

export interface OverlaySnapshot {
  position: OverlayPosition;
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  zIndex: number | null;
  opacity: number;
  backgroundAlpha: number;
  pointerEvents: string;
  meaningfulTextLength: number;
  interactiveDescendantCount: number;
  iframeSource: string | null;
  millisecondsSinceBlockedPopup: number | null;
  role: string | null;
  ariaModal: boolean;
  semanticHints: string[];
}

export interface OverlayAssessment {
  recommendation: OverlayRecommendation;
  confidence: number;
  positiveSignals: number;
  reasons: OverlayReason[];
}

const SUSPICIOUS_IFRAME_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'amazon-adsystem.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
] as const;

const LEGITIMATE_SEMANTIC_HINTS = new Set([
  'cookie-notice',
  'cookie-banner',
  'subtitle',
  'subtitles',
  'caption',
  'captions',
  'menu',
  'video-controls',
  'player-controls',
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function viewportCoverage(snapshot: OverlaySnapshot): number {
  if (snapshot.viewportWidth <= 0 || snapshot.viewportHeight <= 0) {
    return 0;
  }

  const width = clamp(snapshot.width, 0, snapshot.viewportWidth);
  const height = clamp(snapshot.height, 0, snapshot.viewportHeight);
  return (width * height) / (snapshot.viewportWidth * snapshot.viewportHeight);
}

function isPositionedOverContent(position: OverlayPosition): boolean {
  return position === 'fixed' || position === 'absolute';
}

function hostnameMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

function isSuspiciousIframeSource(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  try {
    const url = new URL(value);
    return SUSPICIOUS_IFRAME_HOSTS.some((hostname) => hostnameMatches(url.hostname, hostname));
  } catch {
    return false;
  }
}

function isRecentBlockedPopup(milliseconds: number | null): boolean {
  return (
    milliseconds !== null &&
    Number.isFinite(milliseconds) &&
    milliseconds >= 0 &&
    milliseconds <= RECENT_BLOCKED_POPUP_MS
  );
}

function hasLegitimateSemanticHint(hints: string[]): boolean {
  return hints.some((hint) => LEGITIMATE_SEMANTIC_HINTS.has(hint.toLowerCase()));
}

function isProtectedLegitimateUi(snapshot: OverlaySnapshot): OverlayReason | null {
  const role = snapshot.role?.toLowerCase() ?? null;
  if (snapshot.ariaModal || role === 'dialog' || role === 'alertdialog') {
    return 'legitimate-dialog';
  }

  if (role === 'menu' || hasLegitimateSemanticHint(snapshot.semanticHints)) {
    return 'legitimate-ui';
  }

  return null;
}

export function scoreOverlay(snapshot: OverlaySnapshot): OverlayAssessment {
  const protectedReason = isProtectedLegitimateUi(snapshot);
  if (protectedReason !== null) {
    return {
      recommendation: 'ignore',
      confidence: 0,
      positiveSignals: 0,
      reasons: [protectedReason],
    };
  }

  const reasons: OverlayReason[] = [];
  let confidence = 0;
  let positiveSignals = 0;
  const positioned = isPositionedOverContent(snapshot.position);
  const coverage = viewportCoverage(snapshot);
  const largeCoverage = coverage >= LARGE_VIEWPORT_COVERAGE;
  const pointerEnabled = snapshot.pointerEvents.toLowerCase() !== 'none';

  if (positioned) {
    reasons.push('positioned-over-content');
    confidence += 15;
    positiveSignals += 1;
  }

  if (largeCoverage) {
    reasons.push('large-viewport-coverage');
    confidence += 25;
    positiveSignals += 1;
  }

  if (snapshot.zIndex !== null && snapshot.zIndex >= HIGH_Z_INDEX) {
    reasons.push('high-z-index');
    confidence += 15;
    positiveSignals += 1;
  }

  if (
    positioned &&
    (snapshot.opacity <= NEAR_TRANSPARENT_OPACITY ||
      snapshot.backgroundAlpha <= NEAR_TRANSPARENT_OPACITY)
  ) {
    reasons.push('near-transparent');
    confidence += 15;
    positiveSignals += 1;
  }

  if (positioned && largeCoverage && pointerEnabled) {
    reasons.push('pointer-interception');
    confidence += 10;
    positiveSignals += 1;
  }

  if (
    positioned &&
    snapshot.meaningfulTextLength < 8 &&
    snapshot.interactiveDescendantCount === 0
  ) {
    reasons.push('no-meaningful-content');
    confidence += 10;
    positiveSignals += 1;
  }

  if (isSuspiciousIframeSource(snapshot.iframeSource)) {
    reasons.push('suspicious-iframe-source');
    confidence += 25;
    positiveSignals += 1;
  }

  if (isRecentBlockedPopup(snapshot.millisecondsSinceBlockedPopup)) {
    reasons.push('recent-blocked-popup');
    confidence += 20;
    positiveSignals += 1;
  }

  if (snapshot.meaningfulTextLength >= 20) {
    reasons.push('meaningful-content');
    confidence -= 15;
  }

  if (snapshot.interactiveDescendantCount > 0) {
    reasons.push('interactive-controls');
    confidence -= 10;
  }

  confidence = clamp(Math.round(confidence), 0, 100);
  const recommendation: OverlayRecommendation =
    pointerEnabled &&
    positiveSignals >= MINIMUM_MITIGATION_SIGNALS &&
    confidence >= OVERLAY_MITIGATION_THRESHOLD
      ? 'mitigate'
      : positiveSignals > 0
        ? 'observe'
        : 'ignore';

  return {
    recommendation,
    confidence,
    positiveSignals,
    reasons,
  };
}
