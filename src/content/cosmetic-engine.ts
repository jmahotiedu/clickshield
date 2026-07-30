import { getPolicyCandidates } from '../background/site-policy-store.ts';
import type { SiteMode } from '../shared/settings.ts';

export const COSMETIC_STYLE_ATTRIBUTE = 'data-clickshield-owned';
export const COSMETIC_STYLE_VALUE = 'cosmetic-style';

export interface GenericCosmeticFilters {
  version: number;
  selectors: string[];
  exceptions: Record<string, string[]>;
}

export interface SiteSpecificCosmeticEntry {
  selectors: string[];
  exceptions: string[];
}

export interface SiteSpecificCosmeticFilters {
  version: number;
  domains: Record<string, SiteSpecificCosmeticEntry>;
}

export interface CosmeticValidationResult {
  valid: boolean;
  errors: string[];
  selectorCount: number;
}

export interface QueryRootLike {
  querySelectorAll(selector: string): Iterable<unknown>;
}

function hasBalancedDelimiters(selector: string): boolean {
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '[' || character === '(') {
      stack.push(character);
      continue;
    }

    if (character === ']' || character === ')') {
      const expected = character === ']' ? '[' : '(';
      if (stack.pop() !== expected) {
        return false;
      }
    }
  }

  return quote === null && stack.length === 0 && !escaped;
}

export function isSupportedCosmeticSelector(selector: unknown): selector is string {
  if (typeof selector !== 'string') {
    return false;
  }

  const normalized = selector.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 512 ||
    normalized.startsWith('@') ||
    normalized.includes('{') ||
    normalized.includes('}') ||
    normalized.includes(';') ||
    normalized.includes('\0') ||
    normalized.includes('\n') ||
    normalized.includes('\r')
  ) {
    return false;
  }

  return hasBalancedDelimiters(normalized);
}

function validateSelectorList(
  value: unknown,
  path: string,
  errors: string[],
  selectors: Set<string>,
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }

  value.forEach((selector, index) => {
    if (!isSupportedCosmeticSelector(selector)) {
      errors.push(`${path}[${index}] is not a supported selector.`);
      return;
    }
    selectors.add(selector.trim());
  });
}

function validateExceptionMap(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  for (const [domain, selectors] of Object.entries(value)) {
    if (domain.trim().length === 0) {
      errors.push(`${path} contains an empty domain.`);
      continue;
    }
    validateSelectorList(selectors, `${path}.${domain}`, errors, new Set());
  }
}

export function validateCosmeticConfiguration(
  generic: GenericCosmeticFilters,
  siteSpecific: SiteSpecificCosmeticFilters,
): CosmeticValidationResult {
  const errors: string[] = [];
  const selectors = new Set<string>();

  if (generic.version !== 1) {
    errors.push('Generic cosmetic filters must use version 1.');
  }
  validateSelectorList(generic.selectors, 'generic.selectors', errors, selectors);
  validateExceptionMap(generic.exceptions, 'generic.exceptions', errors);

  if (siteSpecific.version !== 1) {
    errors.push('Site-specific cosmetic filters must use version 1.');
  }

  if (
    typeof siteSpecific.domains !== 'object' ||
    siteSpecific.domains === null ||
    Array.isArray(siteSpecific.domains)
  ) {
    errors.push('siteSpecific.domains must be an object.');
  } else {
    for (const [domain, entry] of Object.entries(siteSpecific.domains)) {
      if (domain.trim().length === 0) {
        errors.push('siteSpecific.domains contains an empty domain.');
        continue;
      }
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        errors.push(`siteSpecific.domains.${domain} must be an object.`);
        continue;
      }
      validateSelectorList(
        entry.selectors,
        `siteSpecific.domains.${domain}.selectors`,
        errors,
        selectors,
      );
      validateSelectorList(
        entry.exceptions,
        `siteSpecific.domains.${domain}.exceptions`,
        errors,
        new Set(),
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    selectorCount: selectors.size,
  };
}

export function resolveCosmeticSelectors(
  hostname: string,
  mode: SiteMode,
  generic: GenericCosmeticFilters,
  siteSpecific: SiteSpecificCosmeticFilters,
): string[] {
  if (mode === 'off') {
    return [];
  }

  const candidates = getPolicyCandidates(hostname.toLowerCase());
  const exceptions = new Set<string>();

  for (const candidate of candidates) {
    for (const selector of generic.exceptions[candidate] ?? []) {
      exceptions.add(selector);
    }
    for (const selector of siteSpecific.domains[candidate]?.exceptions ?? []) {
      exceptions.add(selector);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  const addSelector = (selector: string): void => {
    if (!exceptions.has(selector) && !seen.has(selector)) {
      seen.add(selector);
      resolved.push(selector);
    }
  };

  generic.selectors.forEach(addSelector);
  [...candidates].reverse().forEach((candidate) => {
    siteSpecific.domains[candidate]?.selectors.forEach(addSelector);
  });

  return resolved;
}

export function createCosmeticCss(selectors: string[]): string {
  if (selectors.length === 0) {
    return '';
  }

  return `${selectors.join(',\n')} {\n  display: none !important;\n}\n`;
}

export function estimateHiddenElements(root: QueryRootLike, selectors: string[]): number {
  const elements = new Set<unknown>();

  for (const selector of selectors) {
    try {
      for (const element of root.querySelectorAll(selector)) {
        elements.add(element);
      }
    } catch {
      continue;
    }
  }

  return elements.size;
}
