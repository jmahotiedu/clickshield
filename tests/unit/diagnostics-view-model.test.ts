import { describe, expect, it } from 'vitest';

import type { PopupDecisionLogEntry } from '../../src/background/tab-guardian.ts';
import {
  createDiagnosticsViewModel,
  formatDecisionReason,
  redactDiagnosticDestination,
} from '../../src/popup/diagnostics.ts';

function entry(
  overrides: Partial<PopupDecisionLogEntry> = {},
): PopupDecisionLogEntry {
  return {
    tabId: 20,
    sourceTabId: 10,
    timestamp: 1_000,
    destination: 'https://ads.example/pop?secret=value#fragment',
    decision: {
      outcome: 'block',
      confidence: 90,
      reasons: ['no-approved-user-gesture', 'known-ad-destination'],
    },
    closed: true,
    ...overrides,
  };
}

describe('diagnostic redaction', () => {
  it('shows only the origin for web destinations', () => {
    expect(
      redactDiagnosticDestination('https://user:secret@ads.example/pop?token=secret#fragment'),
    ).toBe('https://ads.example');
  });

  it('fails safely for missing and unsupported destinations', () => {
    expect(redactDiagnosticDestination(null)).toBe('Unknown destination');
    expect(redactDiagnosticDestination('not a url')).toBe('Unsupported destination');
    expect(redactDiagnosticDestination('chrome://settings')).toBe('Unsupported destination');
  });
});

describe('diagnostic reason formatting', () => {
  it('uses plain-language labels for classifier reasons', () => {
    expect(formatDecisionReason('no-approved-user-gesture')).toBe('No recent approved click');
    expect(formatDecisionReason('known-ad-destination')).toBe('Known advertising destination');
    expect(formatDecisionReason('authentication-flow')).toBe('Possible sign-in flow');
  });
});

describe('diagnostics view model', () => {
  it('filters to the active opener tab, sorts newest first, and bounds entries', () => {
    const entries = [
      entry({ timestamp: 1, destination: 'https://first.example/path' }),
      entry({ timestamp: 3, destination: 'https://third.example/path' }),
      entry({ timestamp: 2, destination: 'https://second.example/path' }),
      entry({ sourceTabId: 99, timestamp: 4, destination: 'https://other.example/path' }),
    ];

    const viewModel = createDiagnosticsViewModel(entries, 10, 2);

    expect(viewModel.total).toBe(3);
    expect(viewModel.items).toHaveLength(2);
    expect(viewModel.items.map((item) => item.destination)).toEqual([
      'https://third.example',
      'https://second.example',
    ]);
  });

  it('exposes outcome, confidence, closure, and formatted reasons without full URLs', () => {
    const [item] = createDiagnosticsViewModel([entry()], 10).items;

    expect(item).toEqual({
      outcome: 'block',
      outcomeLabel: 'Blocked',
      confidence: 90,
      destination: 'https://ads.example',
      reasons: ['No recent approved click', 'Known advertising destination'],
      closed: true,
      timestamp: 1_000,
    });
  });

  it('returns an empty model when the current tab has no decisions', () => {
    expect(createDiagnosticsViewModel([entry()], 50)).toEqual({ total: 0, items: [] });
  });
});
