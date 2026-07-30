import { isFiniteNumber, isRecord } from './types.ts';

export const POPUP_DECISION_OUTCOMES = ['allow', 'block', 'observe'] as const;
export type PopupDecisionOutcome = (typeof POPUP_DECISION_OUTCOMES)[number];

export const POPUP_DECISION_REASONS = [
  'site-off',
  'strict-mode-disabled',
  'approved-user-gesture',
  'explicit-new-tab-gesture',
  'synthetic-event',
  'no-approved-user-gesture',
  'cross-site-destination',
  'known-ad-destination',
  'suspicious-creation-timing',
  'unsupported-url',
] as const;

export type PopupDecisionReason = (typeof POPUP_DECISION_REASONS)[number];

export interface PopupDecision {
  outcome: PopupDecisionOutcome;
  confidence: number;
  reasons: PopupDecisionReason[];
}

export function isPopupDecisionReason(value: unknown): value is PopupDecisionReason {
  return (
    typeof value === 'string' && POPUP_DECISION_REASONS.includes(value as PopupDecisionReason)
  );
}

export function isPopupDecision(value: unknown): value is PopupDecision {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.outcome === 'string' &&
    POPUP_DECISION_OUTCOMES.includes(value.outcome as PopupDecisionOutcome) &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 100 &&
    Array.isArray(value.reasons) &&
    value.reasons.every(isPopupDecisionReason)
  );
}
