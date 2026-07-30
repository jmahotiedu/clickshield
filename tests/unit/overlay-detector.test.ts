import { describe, expect, it } from 'vitest';

import { scoreOverlay, type OverlaySnapshot } from '../../src/content/overlay-detector.ts';

function snapshot(overrides: Partial<OverlaySnapshot> = {}): OverlaySnapshot {
  return {
    position: 'static',
    viewportWidth: 1_200,
    viewportHeight: 800,
    width: 200,
    height: 100,
    zIndex: null,
    opacity: 1,
    backgroundAlpha: 1,
    pointerEvents: 'auto',
    meaningfulTextLength: 40,
    interactiveDescendantCount: 1,
    iframeSource: null,
    millisecondsSinceBlockedPopup: null,
    role: null,
    ariaModal: false,
    semanticHints: [],
    ...overrides,
  };
}

describe('transparent overlay scoring', () => {
  it('recommends mitigation only when several independent suspicious signals agree', () => {
    const assessment = scoreOverlay(
      snapshot({
        position: 'fixed',
        width: 1_200,
        height: 800,
        zIndex: 2_147_483_647,
        opacity: 0.01,
        backgroundAlpha: 0,
        meaningfulTextLength: 0,
        interactiveDescendantCount: 0,
        iframeSource: 'https://doubleclick.net/popup-frame',
        millisecondsSinceBlockedPopup: 100,
      }),
    );

    expect(assessment.recommendation).toBe('mitigate');
    expect(assessment.confidence).toBeGreaterThanOrEqual(70);
    expect(assessment.positiveSignals).toBeGreaterThanOrEqual(4);
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        'large-viewport-coverage',
        'near-transparent',
        'suspicious-iframe-source',
        'recent-blocked-popup',
      ]),
    );
  });

  it('observes rather than mitigates when only two suspicious signals exist', () => {
    const assessment = scoreOverlay(
      snapshot({
        iframeSource: 'https://doubleclick.net/frame',
        millisecondsSinceBlockedPopup: 100,
      }),
    );

    expect(assessment.recommendation).toBe('observe');
    expect(assessment.positiveSignals).toBe(2);
  });

  it.each([
    snapshot({
      position: 'fixed',
      width: 1_200,
      height: 800,
      zIndex: 10_000,
      opacity: 0.98,
      role: 'dialog',
      ariaModal: true,
      meaningfulTextLength: 120,
      interactiveDescendantCount: 3,
    }),
    snapshot({
      position: 'fixed',
      width: 1_200,
      height: 180,
      zIndex: 10_000,
      meaningfulTextLength: 220,
      interactiveDescendantCount: 3,
      semanticHints: ['cookie-notice'],
    }),
    snapshot({
      position: 'absolute',
      width: 900,
      height: 80,
      backgroundAlpha: 0,
      pointerEvents: 'none',
      meaningfulTextLength: 80,
      semanticHints: ['subtitle'],
    }),
    snapshot({
      position: 'absolute',
      width: 320,
      height: 480,
      zIndex: 2_000,
      role: 'menu',
      meaningfulTextLength: 80,
      interactiveDescendantCount: 8,
      semanticHints: ['menu'],
    }),
    snapshot({
      position: 'absolute',
      width: 1_200,
      height: 120,
      zIndex: 3_000,
      meaningfulTextLength: 20,
      interactiveDescendantCount: 6,
      semanticHints: ['video-controls'],
    }),
  ])('ignores legitimate dialogs and controls %#', (candidate) => {
    expect(scoreOverlay(candidate).recommendation).toBe('ignore');
  });

  it('never mitigates an element that cannot intercept pointer input', () => {
    const assessment = scoreOverlay(
      snapshot({
        position: 'fixed',
        width: 1_200,
        height: 800,
        zIndex: 10_000,
        opacity: 0,
        backgroundAlpha: 0,
        pointerEvents: 'none',
        meaningfulTextLength: 0,
        interactiveDescendantCount: 0,
        iframeSource: 'https://doubleclick.net/frame',
        millisecondsSinceBlockedPopup: 50,
      }),
    );

    expect(assessment.recommendation).not.toBe('mitigate');
  });
});
