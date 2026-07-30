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

  it('observes a cross-site destination when that is the only signal', () => {
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

    expect(
      classifyPopup(
        evidence({
          destinationUrl: 'https://different.example/article',
        }),
      ),
    ).toMatchObject({
      outcome: 'observe',
      reasons: expect.arrayContaining(['cross-site-destination']),
    });
  });

  it('observes suspicious timing without another strong signal', () => {
    expect(classifyPopup(evidence({ creationDelayMs: 50 }))).toMatchObject({
      outcome: 'observe',
      reasons: expect.arrayContaining([
        'suspicious-creation-timing',
        'no-approved-user-gesture',
      ]),
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

  it('never blocks solely because a destination is cross-origin', () => {
    const decision = classifyPopup(
      evidence({ destinationUrl: 'https://unrelated.example/legitimate' }),
    );

    expect(decision.outcome).toBe('observe');
    expect(decision.reasons).toContain('cross-site-destination');
  });
});
