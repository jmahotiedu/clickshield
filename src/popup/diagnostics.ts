import type { PopupDecisionReason } from '../shared/decisions.ts';
import type { PopupDecisionLogEntry } from '../background/tab-guardian.ts';

export const MAX_POPUP_DIAGNOSTICS = 5;

export interface PopupDiagnosticItem {
  outcome: PopupDecisionLogEntry['decision']['outcome'];
  outcomeLabel: string;
  confidence: number;
  destination: string;
  reasons: string[];
  closed: boolean;
  timestamp: number;
}

export interface PopupDiagnosticsViewModel {
  total: number;
  items: PopupDiagnosticItem[];
}

const REASON_LABELS: Record<PopupDecisionReason, string> = {
  'site-off': 'Protection was off',
  'strict-mode-disabled': 'Strict protection was disabled',
  'approved-user-gesture': 'Approved click detected',
  'explicit-new-tab-gesture': 'Explicit new-tab gesture',
  'valid-popup-token': 'Valid one-use popup authorization',
  'authentication-flow': 'Possible sign-in flow',
  'synthetic-event': 'Synthetic event signal',
  'no-approved-user-gesture': 'No recent approved click',
  'cross-site-destination': 'Different destination site',
  'ungated-cross-site-popup': 'Ungated cross-site popup',
  'known-ad-destination': 'Known advertising destination',
  'suspicious-creation-timing': 'Created immediately after page activity',
  'missing-evidence': 'Not enough evidence',
  'unsupported-url': 'Unsupported destination URL',
};

const OUTCOME_LABELS: Record<PopupDecisionLogEntry['decision']['outcome'], string> = {
  allow: 'Allowed',
  block: 'Blocked',
  observe: 'Observed',
};

export function formatDecisionReason(reason: PopupDecisionReason): string {
  return REASON_LABELS[reason];
}

export function redactDiagnosticDestination(value: string | null): string {
  if (value === null) {
    return 'Unknown destination';
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Unsupported destination';
    }

    return url.origin;
  } catch {
    return 'Unsupported destination';
  }
}

export function createDiagnosticsViewModel(
  entries: PopupDecisionLogEntry[],
  sourceTabId: number,
  limit = MAX_POPUP_DIAGNOSTICS,
): PopupDiagnosticsViewModel {
  const matching = entries
    .filter((entry) => entry.sourceTabId === sourceTabId)
    .sort((left, right) => right.timestamp - left.timestamp);
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_POPUP_DIAGNOSTICS;

  return {
    total: matching.length,
    items: matching.slice(0, boundedLimit).map((entry) => ({
      outcome: entry.decision.outcome,
      outcomeLabel: OUTCOME_LABELS[entry.decision.outcome],
      confidence: entry.decision.confidence,
      destination: redactDiagnosticDestination(entry.destination),
      reasons: entry.decision.reasons.map(formatDecisionReason),
      closed: entry.closed,
      timestamp: entry.timestamp,
    })),
  };
}
