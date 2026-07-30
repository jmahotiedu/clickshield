import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateDist } from '../../tools/check-dist.ts';

const temporaryDirectories: string[] = [];

async function createTemporaryDist(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clickshield-dist-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, 'popup'), { recursive: true });
  await mkdir(path.join(root, 'content'), { recursive: true });
  await mkdir(path.join(root, 'main-world'), { recursive: true });
  await mkdir(path.join(root, 'filters/declarative'), { recursive: true });
  await mkdir(path.join(root, 'filters/cosmetic'), { recursive: true });
  return root;
}

async function writeMinimalPackage(root: string): Promise<void> {
  const manifest = {
    manifest_version: 3,
    name: 'ClickShield',
    version: '0.1.0',
    background: { service_worker: 'background/service-worker.js' },
    action: { default_popup: 'popup/popup.html' },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content/content-script.js'],
      },
      {
        matches: ['<all_urls>'],
        js: ['main-world/popup-guard.js'],
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

  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(root, 'popup/popup.html'),
    '<link rel="stylesheet" href="popup.css"><script src="popup.js"></script>',
  );
  await writeFile(path.join(root, 'popup/popup.css'), 'body {}\n');
  await writeFile(path.join(root, 'popup/popup.js'), 'console.log("popup");\n');
  await writeFile(path.join(root, 'content/content-script.js'), 'console.log("content");\n');
  await writeFile(path.join(root, 'main-world/popup-guard.js'), 'console.log("guard");\n');
  await writeFile(path.join(root, 'filters/declarative/base.json'), '[]\n');
  await writeFile(path.join(root, 'filters/cosmetic/generic.json'), '{"version":1,"selectors":[],"exceptions":{}}\n');
  await writeFile(path.join(root, 'filters/cosmetic/site-specific.json'), '{"version":1,"domains":{}}\n');
  await writeFile(path.join(root, 'filters/metadata.json'), '{"formatVersion":1,"generatedDate":"2026-07-30","rulesets":[]}\n');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('packaged extension validation', () => {
  it('reports a manifest target that is missing from dist', async () => {
    const root = await createTemporaryDist();
    await writeMinimalPackage(root);

    const result = await validateDist(root);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing packaged file: background/service-worker.js');
  });

  it('rejects development-only TypeScript and source-map files', async () => {
    const root = await createTemporaryDist();
    await writeMinimalPackage(root);
    await mkdir(path.join(root, 'background'), { recursive: true });
    await writeFile(path.join(root, 'background/service-worker.js'), 'console.log("worker");\n');
    await writeFile(path.join(root, 'content/debug.ts'), 'export {};\n');
    await writeFile(path.join(root, 'content/content-script.js.map'), '{}\n');

    const result = await validateDist(root);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Forbidden packaged artifact: content/content-script.js.map');
    expect(result.errors).toContain('Forbidden packaged artifact: content/debug.ts');
  });

  it('accepts a complete minimal package', async () => {
    const root = await createTemporaryDist();
    await writeMinimalPackage(root);
    await mkdir(path.join(root, 'background'), { recursive: true });
    await writeFile(path.join(root, 'background/service-worker.js'), 'console.log("worker");\n');

    const result = await validateDist(root);

    expect(result).toEqual({
      valid: true,
      errors: [],
      files: expect.arrayContaining([
        'background/service-worker.js',
        'manifest.json',
        'popup/popup.html',
      ]),
    });
  });
});
