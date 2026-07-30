import { normalizeHostname } from '../background/site-policy-store.ts';
import type { SiteMode } from '../shared/settings.ts';

export interface PopupStatistics {
  blockedRequests: number;
  hiddenElements: number;
}

export interface PopupViewModelInput {
  url: string | null | undefined;
  mode: SiteMode;
  statistics?: Partial<PopupStatistics>;
}

export interface PopupViewModel {
  supported: boolean;
  hostname: string;
  mode: SiteMode;
  blockedRequests: number;
  hiddenElements: number;
  strictDescription: string;
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function createPopupViewModel(input: PopupViewModelInput): PopupViewModel {
  const hostname = input.url === null || input.url === undefined ? null : normalizeHostname(input.url);

  return {
    supported: hostname !== null,
    hostname: hostname ?? 'Unsupported browser page',
    mode: hostname === null ? 'off' : input.mode,
    blockedRequests: toNonNegativeInteger(input.statistics?.blockedRequests),
    hiddenElements: toNonNegativeInteger(input.statistics?.hiddenElements),
    strictDescription:
      'Strict mode also blocks suspicious pop-ups, pop-unders, and invisible click overlays.',
  };
}
