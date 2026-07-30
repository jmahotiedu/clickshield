import { describe, expect, it } from 'vitest';

import { type ExtensionManifest, validateManifest } from '../../tools/validate-manifest.ts';

const validManifest: ExtensionManifest = {
  manifest_version: 3,
  name: 'ClickShield',
  version: '0.1.0',
  background: {
    service_worker: 'background/service-worker.js',
  },
  action: {
    default_popup: 'popup/popup.html',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content/content-script.js'],
    },
  ],
  declarative_net_request: {
    rule_resources: [
      {
        id: 'base',
        enabled: true,
        path: 'filters/declarative/base.json',
      },
    ],
  },
};

describe('manifest validation', () => {
  it('accepts the required Manifest V3 fields and entry points', () => {
    const result = validateManifest(validManifest);

    expect(result).toEqual({
      valid: true,
      errors: [],
      referencedFiles: [
        'background/service-worker.js',
        'content/content-script.js',
        'filters/declarative/base.json',
        'popup/popup.html',
      ],
    });
  });

  it('rejects a manifest that is not Manifest V3', () => {
    const result = validateManifest({ ...validManifest, manifest_version: 2 });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('manifest_version must equal 3.');
  });

  it('rejects missing extension entry points', () => {
    const result = validateManifest({
      manifest_version: 3,
      name: 'ClickShield',
      version: '0.1.0',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'background must be an object.',
        'action must be an object.',
        'content_scripts must contain at least one entry.',
        'declarative_net_request.rule_resources must be an array.',
      ]),
    );
  });

  it('rejects remotely hosted executable and rule entry points', () => {
    const result = validateManifest({
      ...validManifest,
      background: {
        service_worker: 'https://example.com/remote-worker.js',
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['https://example.com/remote-content.js'],
        },
      ],
      declarative_net_request: {
        rule_resources: [
          {
            id: 'base',
            path: 'https://example.com/remote-rules.json',
          },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'background.service_worker must be a local relative path.',
        'content_scripts[0].js[0] must be a local relative path.',
        'declarative_net_request.rule_resources[0].path must be a local relative path.',
      ]),
    );
  });
});
