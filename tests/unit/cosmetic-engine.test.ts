import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createCosmeticCss,
  estimateHiddenElements,
  resolveCosmeticSelectors,
  validateCosmeticConfiguration,
  type GenericCosmeticFilters,
  type SiteSpecificCosmeticFilters,
} from '../../src/content/cosmetic-engine.ts';

const genericFilters: GenericCosmeticFilters = {
  version: 1,
  selectors: ['[data-ad-slot]', '.adsbygoogle'],
  exceptions: {
    'trusted.example.com': ['[data-ad-slot]'],
  },
};

const siteSpecificFilters: SiteSpecificCosmeticFilters = {
  version: 1,
  domains: {
    'example.com': {
      selectors: ['.sponsored-card'],
      exceptions: [],
    },
  },
};

describe('cosmetic selector resolution', () => {
  it.each(['standard', 'strict'] as const)('applies generic selectors in %s mode', (mode) => {
    expect(
      resolveCosmeticSelectors('video.other.test', mode, genericFilters, siteSpecificFilters),
    ).toEqual(['[data-ad-slot]', '.adsbygoogle']);
  });

  it('applies domain-specific selectors only to matching domains and subdomains', () => {
    expect(
      resolveCosmeticSelectors('watch.example.com', 'standard', genericFilters, siteSpecificFilters),
    ).toContain('.sponsored-card');
    expect(
      resolveCosmeticSelectors('unrelated.test', 'standard', genericFilters, siteSpecificFilters),
    ).not.toContain('.sponsored-card');
  });

  it('lets a matching domain exception suppress a generic selector', () => {
    expect(
      resolveCosmeticSelectors(
        'trusted.example.com',
        'standard',
        genericFilters,
        siteSpecificFilters,
      ),
    ).not.toContain('[data-ad-slot]');
  });

  it('applies no cosmetic selectors in Off mode', () => {
    expect(
      resolveCosmeticSelectors('example.com', 'off', genericFilters, siteSpecificFilters),
    ).toEqual([]);
  });
});

describe('cosmetic filter validation', () => {
  it('accepts the conservative supported selector subset', () => {
    expect(validateCosmeticConfiguration(genericFilters, siteSpecificFilters)).toEqual({
      valid: true,
      errors: [],
      selectorCount: 3,
    });
  });

  it.each(['', '.ad { color: red; }', '[data-ad-slot', '@import url(https://example.com)'])(
    'rejects invalid or injectable selector %j',
    (selector) => {
      const result = validateCosmeticConfiguration(
        { ...genericFilters, selectors: [selector] },
        siteSpecificFilters,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    },
  );
});

describe('cosmetic CSS and estimates', () => {
  it('generates one hide rule for the resolved selector list', () => {
    expect(createCosmeticCss(['[data-ad-slot]', '.sponsored-card'])).toBe(
      '[data-ad-slot],\n.sponsored-card {\n  display: none !important;\n}\n',
    );
  });

  it('deduplicates elements matched by multiple selectors', () => {
    const repeatedElement = { id: 'same-ad' };
    const root = {
      querySelectorAll(selector: string): Iterable<unknown> {
        return selector === '.adsbygoogle' ? [repeatedElement] : [repeatedElement, { id: selector }];
      },
    };

    expect(estimateHiddenElements(root, ['[data-ad-slot]', '.adsbygoogle'])).toBe(2);
  });

  it('keeps legitimate fixture controls outside the generated hide rule', async () => {
    const fixture = await readFile(
      path.resolve('tests/fixtures/cosmetic-ads.html'),
      'utf8',
    );
    const selectors = resolveCosmeticSelectors(
      'watch.example.com',
      'standard',
      genericFilters,
      siteSpecificFilters,
    );
    const css = createCosmeticCss(selectors);

    expect(fixture).toContain('data-testid="player-controls"');
    expect(css).not.toContain('[data-testid="player-controls"]');
  });
});
