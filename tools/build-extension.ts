import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

import {
  validateCosmeticConfiguration,
  type GenericCosmeticFilters,
  type SiteSpecificCosmeticFilters,
} from '../src/content/cosmetic-engine.ts';
import { validatePackagedManifest } from './validate-manifest.ts';
import { validateProjectRulesets } from './validate-rulesets.ts';

const projectRoot = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(projectRoot, 'dist');

const sharedBuildOptions = {
  bundle: true,
  charset: 'utf8' as const,
  legalComments: 'none' as const,
  minify: false,
  platform: 'browser' as const,
  sourcemap: false,
  target: 'chrome111',
};

async function buildScripts(): Promise<void> {
  await build({
    ...sharedBuildOptions,
    entryPoints: {
      'background/service-worker': path.join(projectRoot, 'src/background/service-worker.ts'),
    },
    format: 'esm',
    outdir: distRoot,
  });

  await build({
    ...sharedBuildOptions,
    entryPoints: {
      'content/content-script': path.join(projectRoot, 'src/content/content-script.ts'),
      'main-world/popup-guard': path.join(projectRoot, 'src/main-world/popup-guard.ts'),
      'popup/popup': path.join(projectRoot, 'src/popup/popup.ts'),
    },
    format: 'iife',
    outdir: distRoot,
  });
}

async function copyStaticAssets(): Promise<void> {
  await mkdir(path.join(distRoot, 'popup'), { recursive: true });
  await cp(path.join(projectRoot, 'src/popup/popup.html'), path.join(distRoot, 'popup/popup.html'));
  await cp(path.join(projectRoot, 'src/popup/popup.css'), path.join(distRoot, 'popup/popup.css'));
  await cp(path.join(projectRoot, 'filters'), path.join(distRoot, 'filters'), { recursive: true });

  const rawManifest = await readFile(path.join(projectRoot, 'manifest.json'), 'utf8');
  const normalizedManifest = `${JSON.stringify(JSON.parse(rawManifest), null, 2)}\n`;
  await writeFile(path.join(distRoot, 'manifest.json'), normalizedManifest, 'utf8');
}

async function validateProjectCosmeticFilters(): Promise<{
  valid: boolean;
  errors: string[];
  selectorCount: number;
}> {
  const generic = JSON.parse(
    await readFile(path.join(projectRoot, 'filters/cosmetic/generic.json'), 'utf8'),
  ) as GenericCosmeticFilters;
  const siteSpecific = JSON.parse(
    await readFile(path.join(projectRoot, 'filters/cosmetic/site-specific.json'), 'utf8'),
  ) as SiteSpecificCosmeticFilters;

  return validateCosmeticConfiguration(generic, siteSpecific);
}

async function main(): Promise<void> {
  const rulesetResult = await validateProjectRulesets(projectRoot);
  if (!rulesetResult.valid) {
    throw new Error(`Declarative network rules are invalid:\n${rulesetResult.errors.join('\n')}`);
  }

  const cosmeticResult = await validateProjectCosmeticFilters();
  if (!cosmeticResult.valid) {
    throw new Error(`Cosmetic filters are invalid:\n${cosmeticResult.errors.join('\n')}`);
  }

  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });

  await buildScripts();
  await copyStaticAssets();

  const result = await validatePackagedManifest(path.join(distRoot, 'manifest.json'), distRoot);
  if (!result.valid) {
    throw new Error(`Packaged extension is invalid:\n${result.errors.join('\n')}`);
  }

  console.log(
    `Built ClickShield into ${distRoot} with ${rulesetResult.ruleCount} network rules and ${cosmeticResult.selectorCount} cosmetic selectors.`,
  );
}

await main();
