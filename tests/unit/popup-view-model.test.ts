import { describe, expect, it } from 'vitest';

import { createPopupViewModel } from '../../src/popup/view-model.ts';

describe('popup view model', () => {
  it('shows the supported hostname, mode, and page statistics', () => {
    expect(
      createPopupViewModel({
        url: 'https://Player.Example.com/watch',
        mode: 'strict',
        statistics: {
          blockedRequests: 12,
          hiddenElements: 3,
        },
      }),
    ).toMatchObject({
      supported: true,
      hostname: 'player.example.com',
      mode: 'strict',
      blockedRequests: 12,
      hiddenElements: 3,
    });
  });

  it('adds active-tab declarative matches to directly observed blocks', () => {
    expect(
      createPopupViewModel({
        url: 'https://example.com',
        mode: 'standard',
        statistics: {
          blockedRequests: 2,
          hiddenElements: 1,
        },
        matchedNetworkRules: 7,
      }),
    ).toMatchObject({
      blockedRequests: 9,
      hiddenElements: 1,
    });
  });

  it('disables protection controls for unsupported browser pages', () => {
    expect(
      createPopupViewModel({
        url: 'chrome://extensions',
        mode: 'standard',
      }),
    ).toMatchObject({
      supported: false,
      hostname: 'Unsupported browser page',
      mode: 'off',
    });
  });

  it('sanitizes unavailable or invalid counters to zero', () => {
    expect(
      createPopupViewModel({
        url: 'https://example.com',
        mode: 'standard',
        statistics: {
          blockedRequests: -1,
          hiddenElements: 1.5,
        },
        matchedNetworkRules: -3,
      }),
    ).toMatchObject({
      blockedRequests: 0,
      hiddenElements: 0,
    });
  });

  it('explains the additional Strict-mode behavior', () => {
    const viewModel = createPopupViewModel({
      url: 'https://example.com',
      mode: 'standard',
    });

    expect(viewModel.strictDescription).toContain('pop-ups');
    expect(viewModel.strictDescription).toContain('invisible click overlays');
  });
});
