export const SITE_MODES = ['off', 'standard', 'strict'] as const;
export type SiteMode = (typeof SITE_MODES)[number];

// Personal/dev default: Strict so pop-under closure is on without per-site clicks.
// Network+cosmetic still apply; popup/overlay enforcement needs Strict.
export const DEFAULT_SITE_MODE: SiteMode = 'strict';

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === 'string' && SITE_MODES.includes(value as SiteMode);
}
