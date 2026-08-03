import { describe, expect, it } from 'vitest';

import {
  classifyPopup,
  type PopupClassificationEvidence,
} from '../../src/background/popup-classifier.ts';

function evidence(
  overrides: Partial<PopupClassificationEvidence> = {},
): PopupClassificationEvidence {
  return {
    mode: 'strict',
    sourceUrl: 'https://player.example/watch',
    destinationUrl: 'https://player.example/details',
    approvedGesture: false,
    explicitNewContext: false,
    popupTokenValid: false,
    syntheticEvent: false,
    knownAdDestination: false,
    authenticationFlow: false,
    creationDelayMs: null,
    ...overrides,
  };
}

describe('popup classifier hard overrides', () => {
  it('allows when Strict mode is disabled', () => {
    expect(classifyPopup(evidence({ mode: 'standard' }))).toMatchObject({
      outcome: 'allow',
      reasons: ['strict-mode-disabled'],
    });
  });

  it('allows explicit new-tab gestures', () => {
    expect(classifyPopup(evidence({ explicitNewContext: true }))).toMatchObject({
      outcome: 'allow',
      reasons: ['explicit-new-tab-gesture'],
    });
  });

  it('allows a valid popup token', () => {
    expect(classifyPopup(evidence({ popupTokenValid: true }))).toMatchObject({
      outcome: 'allow',
      reasons: ['valid-popup-token'],
    });
  });

  it('observes authentication flows instead of blocking them', () => {
    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://login.identity.example/oauth/authorize',
          authenticationFlow: true,
        }),
      ),
    ).toMatchObject({
      outcome: 'observe',
      reasons: ['authentication-flow'],
    });
  });
});

describe('popup classifier evidence scoring', () => {
  it('blocks a known ad destination without an approved gesture', () => {
    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://ads.example/pop',
          knownAdDestination: true,
        }),
      ),
    ).toMatchObject({
      outcome: 'block',
      reasons: expect.arrayContaining(['known-ad-destination', 'no-approved-user-gesture']),
    });
  });

  it('blocks an ungated cross-site destination without needing a known-ad host', () => {
    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://unlimitedadblocker.net/unlimited.php',
        }),
      ),
    ).toMatchObject({
      outcome: 'block',
      reasons: expect.arrayContaining([
        'cross-site-destination',
        'ungated-cross-site-popup',
        'no-approved-user-gesture',
      ]),
    });
  });

  it('still allows approved gestures to cross-site destinations', () => {
    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://different.example/article',
          approvedGesture: true,
        }),
      ),
    ).toMatchObject({
      outcome: 'allow',
      reasons: ['approved-user-gesture'],
    });
  });

  it('observes suspicious timing without another strong signal', () => {
    expect(classifyPopup(evidence({ creationDelayMs: 50 }))).toMatchObject({
      outcome: 'observe',
      reasons: expect.arrayContaining(['suspicious-creation-timing', 'no-approved-user-gesture']),
    });
  });

  it('blocks a synthetic event aimed at a known ad destination', () => {
    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://ads.example/pop',
          syntheticEvent: true,
          knownAdDestination: true,
        }),
      ),
    ).toMatchObject({
      outcome: 'block',
      reasons: expect.arrayContaining(['synthetic-event', 'known-ad-destination']),
    });
  });

  it('observes when evidence is missing', () => {
    expect(
      classifyPopup(
        evidence({
          sourceUrl: null,
          destinationUrl: null,
        }),
      ),
    ).toMatchObject({
      outcome: 'observe',
      reasons: expect.arrayContaining(['missing-evidence']),
    });
  });
});

describe('popup classifier invariants', () => {
  it.each([
    evidence({ approvedGesture: true, knownAdDestination: true }),
    evidence({ explicitNewContext: true, knownAdDestination: true, syntheticEvent: true }),
    evidence({ popupTokenValid: true, knownAdDestination: true, creationDelayMs: 0 }),
  ])('never blocks an explicitly approved popup %#', (input) => {
    expect(classifyPopup(input).outcome).not.toBe('block');
  });

  it('does not treat same-site ungated navigation as a cross-site popup block', () => {
    const decision = classifyPopup(
      evidence({ destinationUrl: 'https://player.example/legitimate' }),
    );

    expect(decision.outcome).toBe('observe');
    expect(decision.reasons).not.toContain('ungated-cross-site-popup');
  });
});
