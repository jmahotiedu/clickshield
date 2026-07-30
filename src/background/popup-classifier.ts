import type { PopupDecision, PopupDecisionReason } from '../shared/decisions.ts';
import type { SiteMode } from '../shared/settings.ts';

export const SUSPICIOUS_CREATION_DELAY_MS = 750;
export const BLOCK_CONFIDENCE_THRESHOLD = 80;

export interface PopupClassificationEvidence {
  mode: SiteMode;
  sourceUrl: string | null;
  destinationUrl: string | null;
  approvedGesture: boolean;
  explicitNewContext: boolean;
  popupTokenValid: boolean;
  syntheticEvent: boolean;
  knownAdDestination: boolean;
  authenticationFlow: boolean;
  creationDelayMs: number | null;
}

function createDecision(
  outcome: PopupDecision['outcome'],
  confidence: number,
  reasons: PopupDecisionReason[],
): PopupDecision {
  return {
    outcome,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    reasons,
  };
}

function parseOrigin(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function isSuspiciousTiming(delayMs: number | null): boolean {
  return (
    delayMs !== null &&
    Number.isFinite(delayMs) &&
    delayMs >= 0 &&
    delayMs <= SUSPICIOUS_CREATION_DELAY_MS
  );
}

export function classifyPopup(evidence: PopupClassificationEvidence): PopupDecision {
  if (evidence.mode === 'off') {
    return createDecision('allow', 100, ['site-off']);
  }

  if (evidence.mode !== 'strict') {
    return createDecision('allow', 100, ['strict-mode-disabled']);
  }

  if (evidence.explicitNewContext) {
    return createDecision('allow', 100, ['explicit-new-tab-gesture']);
  }

  if (evidence.popupTokenValid) {
    return createDecision('allow', 100, ['valid-popup-token']);
  }

  if (evidence.approvedGesture) {
    return createDecision('allow', 100, ['approved-user-gesture']);
  }

  if (evidence.authenticationFlow) {
    return createDecision('observe', 35, ['authentication-flow']);
  }

  const reasons: PopupDecisionReason[] = ['no-approved-user-gesture'];
  let confidence = 20;

  if (evidence.syntheticEvent) {
    reasons.push('synthetic-event');
    confidence += 20;
  }

  if (evidence.knownAdDestination) {
    reasons.push('known-ad-destination');
    confidence += 60;
  }

  if (isSuspiciousTiming(evidence.creationDelayMs)) {
    reasons.push('suspicious-creation-timing');
    confidence += 15;
  }

  const sourceOrigin = parseOrigin(evidence.sourceUrl);
  const destinationOrigin = parseOrigin(evidence.destinationUrl);

  if (sourceOrigin === null || destinationOrigin === null) {
    reasons.push('missing-evidence');
  } else if (sourceOrigin !== destinationOrigin) {
    reasons.push('cross-site-destination');
    confidence += 10;
  }

  if (evidence.knownAdDestination && confidence >= BLOCK_CONFIDENCE_THRESHOLD) {
    return createDecision('block', confidence, reasons);
  }

  return createDecision('observe', confidence, reasons);
}
