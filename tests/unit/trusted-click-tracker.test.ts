import { describe, expect, it } from 'vitest';

import { PopupTokenStore } from '../../src/main-world/popup-token-store.ts';
import {
  interpretTrustedGesture,
  type GestureEventRecord,
} from '../../src/main-world/trusted-click-tracker.ts';

function pointerEvent(overrides: Partial<GestureEventRecord> = {}): GestureEventRecord {
  return {
    kind: 'pointer',
    trusted: true,
    timestamp: 1_000,
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: null,
    href: 'https://example.com/watch',
    ...overrides,
  };
}

describe('trusted gesture interpretation', () => {
  it('approves a trusted primary click', () => {
    expect(interpretTrustedGesture(pointerEvent())).toMatchObject({
      approved: true,
      explicitNewContext: false,
      synthetic: false,
    });
  });

  it.each([
    pointerEvent({ button: 1 }),
    pointerEvent({ ctrlKey: true }),
    pointerEvent({ metaKey: true }),
    pointerEvent({ shiftKey: true }),
  ])('recognizes an explicit new-tab or new-window gesture', (event) => {
    expect(interpretTrustedGesture(event)).toMatchObject({
      approved: true,
      explicitNewContext: true,
    });
  });

  it('approves trusted keyboard activation', () => {
    expect(
      interpretTrustedGesture({
        ...pointerEvent(),
        kind: 'keyboard',
        button: null,
        key: 'Enter',
      }),
    ).toMatchObject({
      approved: true,
      explicitNewContext: false,
      source: 'keyboard',
    });
  });

  it('rejects synthetic events', () => {
    expect(interpretTrustedGesture(pointerEvent({ trusted: false }))).toMatchObject({
      approved: false,
      synthetic: true,
    });
  });
});

describe('PopupTokenStore', () => {
  it('expires tokens using an injected monotonic clock', () => {
    let now = 1_000;
    const store = new PopupTokenStore(() => now, 250);

    store.issue({ href: 'https://example.com', explicitNewContext: false });
    now = 1_251;

    expect(store.consume()).toBeNull();
  });

  it('consumes a token at most once', () => {
    const store = new PopupTokenStore(() => 1_000, 250);
    store.issue({ href: 'https://example.com', explicitNewContext: false });

    expect(store.consume()).toMatchObject({ href: 'https://example.com' });
    expect(store.consume()).toBeNull();
  });

  it('replaces stale context when a new gesture arrives', () => {
    let now = 1_000;
    const store = new PopupTokenStore(() => now, 250);

    store.issue({ href: 'https://old.example', explicitNewContext: false });
    now = 1_050;
    store.issue({ href: 'https://new.example', explicitNewContext: true });

    expect(store.consume()).toMatchObject({
      href: 'https://new.example',
      explicitNewContext: true,
    });
  });
});
