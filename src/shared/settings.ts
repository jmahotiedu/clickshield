export const SITE_MODES = ['off', 'standard', 'strict'] as const;
export type SiteMode = (typeof SITE_MODES)[number];

export const DEFAULT_SITE_MODE: SiteMode = 'standard';

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === 'string' && SITE_MODES.includes(value as SiteMode);
}
