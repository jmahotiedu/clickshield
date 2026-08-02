import { describe, expect, it } from 'vitest';

import {
  clearBlockedPopupTimestamp,
  getLastBlockedPopupTimestamp,
  recordBlockedPopupTimestamp,
} from '../../src/shared/blocked-popup-signal.ts';

describe('blocked popup overlay signal', () => {
  it('records and clears the last blocked popup timestamp', () => {
    clearBlockedPopupTimestamp();
    expect(getLastBlockedPopupTimestamp()).toBeNull();

    recordBlockedPopupTimestamp(1_700_000_000_000);
    expect(getLastBlockedPopupTimestamp()).toBe(1_700_000_000_000);

    clearBlockedPopupTimestamp();
    expect(getLastBlockedPopupTimestamp()).toBeNull();
  });

  it('ignores non-finite timestamps', () => {
    clearBlockedPopupTimestamp();
    recordBlockedPopupTimestamp(Number.NaN);
    expect(getLastBlockedPopupTimestamp()).toBeNull();
  });
});
