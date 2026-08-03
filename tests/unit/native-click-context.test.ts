import { describe, expect, it } from 'vitest';

import {
  clickContextApprovesNavigation,
  clickContextIsExplicitNewTab,
  resolveLinkOpensNewContext,
  type NativeClickContext,
} from '../../src/shared/native-click-context.ts';

function click(overrides: Partial<NativeClickContext> = {}): NativeClickContext {
  return {
    timestamp: 1_000,
    button: 0,
    modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    trusted: true,
    href: 'https://ads.example/pop',
    targetBlank: true,
    ...overrides,
  };
}

describe('native click-context approval', () => {
  it('approves a trusted left-click on a target=_blank link', () => {
    expect(clickContextApprovesNavigation(click())).toBe(true);
    expect(clickContextIsExplicitNewTab(click())).toBe(false);
  });

  it('approves trusted middle-click and modifier new-tab gestures', () => {
    expect(clickContextApprovesNavigation(click({ button: 1, targetBlank: false }))).toBe(true);
    expect(clickContextIsExplicitNewTab(click({ button: 1, targetBlank: false }))).toBe(true);

    expect(
      clickContextApprovesNavigation(
        click({
          targetBlank: false,
          modifiers: { alt: false, ctrl: true, meta: false, shift: false },
        }),
      ),
    ).toBe(true);
    expect(
      clickContextIsExplicitNewTab(
        click({
          targetBlank: false,
          modifiers: { alt: false, ctrl: true, meta: false, shift: false },
        }),
      ),
    ).toBe(true);
  });

  it('rejects synthetic link activations and non-link clicks', () => {
    expect(clickContextApprovesNavigation(click({ trusted: false }))).toBe(false);
    expect(clickContextApprovesNavigation(click({ href: null, targetBlank: false }))).toBe(false);
    expect(clickContextApprovesNavigation(click({ targetBlank: false, button: 0 }))).toBe(false);
  });

  it('treats case-insensitive _blank and base target=_blank as new context', () => {
    const blankLink = {
      getAttribute(name: string) {
        return name === 'target' ? '_Blank' : null;
      },
    } as unknown as Element;
    expect(resolveLinkOpensNewContext(blankLink, null)).toBe(true);

    const plainLink = {
      getAttribute() {
        return null;
      },
    } as unknown as Element;
    const doc = {
      querySelector() {
        return {
          getAttribute() {
            return '_BLANK';
          },
        };
      },
    } as unknown as Document;
    expect(resolveLinkOpensNewContext(plainLink, doc)).toBe(true);
    expect(resolveLinkOpensNewContext(plainLink, null)).toBe(false);
  });
});
