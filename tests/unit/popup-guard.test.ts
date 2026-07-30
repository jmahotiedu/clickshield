import { describe, expect, it, vi } from 'vitest';

import {
  createGuardedWindowOpen,
  sanitizePopupAttempt,
  type GuardedWindowOpenOptions,
} from '../../src/main-world/popup-guard.ts';

function strictOptions(
  overrides: Partial<GuardedWindowOpenOptions> = {},
): GuardedWindowOpenOptions {
  return {
    getMode: () => 'strict',
    consumeGesture: () => null,
    publishAttempt: () => undefined,
    clock: () => 1_000,
    baseUrl: () => 'https://player.example/watch',
    ...overrides,
  };
}

describe('guarded window.open', () => {
  it('preserves allowed arguments, return value, and receiver outside Strict mode', () => {
    const returned = { opened: true };
    const original = vi.fn(function (this: unknown) {
      return returned;
    });
    const consumeGesture = vi.fn(() => null);
    const publishAttempt = vi.fn();
    const guarded = createGuardedWindowOpen(
      original,
      strictOptions({ getMode: () => 'standard', consumeGesture, publishAttempt }),
    );
    const receiver = { name: 'window-like' };

    expect(guarded.call(receiver, 'https://example.com/path', '_blank', 'noopener,width=400')).toBe(
      returned,
    );
    expect(original).toHaveBeenCalledWith(
      'https://example.com/path',
      '_blank',
      'noopener,width=400',
    );
    expect(original.mock.contexts[0]).toBe(receiver);
    expect(consumeGesture).not.toHaveBeenCalled();
    expect(publishAttempt).toHaveBeenCalledWith({
      url: 'https://example.com/path',
      target: '_blank',
      timestamp: 1_000,
      blocked: false,
      approvedGesture: false,
      explicitNewContext: false,
      syntheticEvent: false,
    });
  });

  it('allows a Strict-mode open with a valid one-use gesture and publishes the gesture summary', () => {
    const original = vi.fn(() => ({ opened: true }));
    const publishAttempt = vi.fn();
    const guarded = createGuardedWindowOpen(
      original,
      strictOptions({
        publishAttempt,
        consumeGesture: () => ({
          explicitNewContext: true,
          source: 'pointer',
          timestamp: 990,
          href: 'https://example.com/path',
        }),
      }),
    );

    expect(guarded('https://example.com/path', '_blank')).toEqual({ opened: true });
    expect(original).toHaveBeenCalledOnce();
    expect(publishAttempt).toHaveBeenCalledWith({
      url: 'https://example.com/path',
      target: '_blank',
      timestamp: 1_000,
      blocked: false,
      approvedGesture: true,
      explicitNewContext: true,
      syntheticEvent: false,
    });
  });

  it('returns null and publishes a sanitized record for an unapproved Strict-mode open', () => {
    const original = vi.fn(() => ({ opened: true }));
    const publishAttempt = vi.fn();
    const guarded = createGuardedWindowOpen(original, strictOptions({ publishAttempt }));

    expect(
      guarded('https://ads.example/popup?account=secret#tracking', '_blank', 'width=400'),
    ).toBeNull();
    expect(original).not.toHaveBeenCalled();
    expect(publishAttempt).toHaveBeenCalledWith({
      url: 'https://ads.example/popup',
      target: '_blank',
      timestamp: 1_000,
      blocked: true,
      approvedGesture: false,
      explicitNewContext: false,
      syntheticEvent: false,
    });
  });

  it('fails open when guard logic throws', () => {
    const returned = { opened: true };
    const original = vi.fn(() => returned);
    const guarded = createGuardedWindowOpen(
      original,
      strictOptions({
        getMode: () => {
          throw new Error('mode unavailable');
        },
      }),
    );

    expect(guarded('https://example.com')).toBe(returned);
    expect(original).toHaveBeenCalledOnce();
  });
});

describe('popup-attempt sanitization', () => {
  it('resolves relative URLs and strips credentials, queries, fragments, and features', () => {
    expect(
      sanitizePopupAttempt(
        '/auth/callback?code=secret#fragment',
        '_blank',
        10,
        'https://player.example/watch',
        false,
        null,
      ),
    ).toEqual({
      url: 'https://player.example/auth/callback',
      target: '_blank',
      timestamp: 10,
      blocked: false,
      approvedGesture: false,
      explicitNewContext: false,
      syntheticEvent: false,
    });
  });
});
