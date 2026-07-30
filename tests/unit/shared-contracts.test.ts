import { describe, expect, it } from 'vitest';

import {
  isPopupDecision,
  isPopupDecisionReason,
  POPUP_DECISION_REASONS,
} from '../../src/shared/decisions.ts';
import { isExtensionMessage, type ExtensionMessage } from '../../src/shared/messages.ts';
import { DEFAULT_SITE_MODE, isSiteMode, SITE_MODES } from '../../src/shared/settings.ts';

const validMessages: ExtensionMessage[] = [
  {
    type: 'click-context',
    payload: {
      timestamp: 1,
      button: 0,
      modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      trusted: true,
      href: 'https://example.com/',
    },
  },
  {
    type: 'popup-attempt',
    payload: {
      url: 'https://example.com/',
      target: '_blank',
      timestamp: 2,
    },
  },
  {
    type: 'blocked-action',
    payload: {
      category: 'popup',
      reason: 'no-approved-user-gesture',
      tabId: 4,
    },
  },
  {
    type: 'settings-request',
    payload: {
      operation: 'get',
      hostname: 'example.com',
    },
  },
  {
    type: 'settings-request',
    payload: {
      operation: 'set',
      hostname: 'example.com',
      mode: 'strict',
    },
  },
  {
    type: 'statistics-update',
    payload: {
      tabId: 4,
      blockedRequests: 3,
      hiddenElements: 2,
    },
  },
];

describe('site-mode contracts', () => {
  it('defines the three supported site modes and Standard as the default', () => {
    expect(SITE_MODES).toEqual(['off', 'standard', 'strict']);
    expect(DEFAULT_SITE_MODE).toBe('standard');
    expect(SITE_MODES.every(isSiteMode)).toBe(true);
    expect(isSiteMode('aggressive')).toBe(false);
  });
});

describe('extension message validation', () => {
  it.each(validMessages)('accepts a valid $type message', (message) => {
    expect(isExtensionMessage(message)).toBe(true);
  });

  it.each([
    null,
    {},
    { type: 'unknown', payload: {} },
    { type: 'click-context', payload: { timestamp: 1 } },
    {
      type: 'settings-request',
      payload: { operation: 'set', hostname: 'example.com', mode: 'aggressive' },
    },
    {
      type: 'statistics-update',
      payload: { tabId: 1, blockedRequests: -1, hiddenElements: 0 },
    },
    {
      type: 'popup-attempt',
      payload: { url: 'https://example.com', target: null, timestamp: 1, extra: true },
    },
  ])('rejects malformed boundary input %#', (message) => {
    expect(isExtensionMessage(message)).toBe(false);
  });
});

describe('popup decision contracts', () => {
  it('recognizes every documented decision reason', () => {
    expect(POPUP_DECISION_REASONS.every(isPopupDecisionReason)).toBe(true);
    expect(isPopupDecisionReason('made-up-reason')).toBe(false);
  });

  it('accepts bounded, explainable popup decisions', () => {
    expect(
      isPopupDecision({
        outcome: 'observe',
        confidence: 65,
        reasons: ['cross-site-destination', 'suspicious-creation-timing'],
      }),
    ).toBe(true);
  });

  it('rejects invalid outcomes, confidence, and reasons', () => {
    expect(isPopupDecision({ outcome: 'close', confidence: 65, reasons: [] })).toBe(false);
    expect(isPopupDecision({ outcome: 'block', confidence: 101, reasons: [] })).toBe(false);
    expect(
      isPopupDecision({ outcome: 'block', confidence: 90, reasons: ['made-up-reason'] }),
    ).toBe(false);
  });
});
