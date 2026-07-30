import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePackagedManifest } from './validate-manifest.ts';

export interface DistValidationResult {
  valid: boolean;
  errors: string[];
  files: string[];
}

const REQUIRED_SUPPORT_FILES = [
  'filters/cosmetic/generic.json',
  'filters/cosmetic/site-specific.json',
  'filters/metadata.json',
  'popup/popup.css',
  'popup/popup.js',
] as const;

const FORBIDDEN_FILE_EXTENSIONS = new Set(['.map', '.ts', '.tsx']);
const REMOTE_URL_PATTERN = /^(?:https?:)?\/\//i;

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function collectFiles(root: string): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = [];
  const errors: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      const stats = await lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        errors.push(`Symbolic links are not allowed in dist: ${relativePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  try {
    await visit(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Could not inspect dist directory: ${message}`);
  }

  return { files: files.sort(), errors };
}

function collectPopupReferences(html: string, errors: string[]): string[] {
  const references: string[] = [];
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/gi;

  for (const match of html.matchAll(attributePattern)) {
    const value = match[1];
    if (value === undefined || value.startsWith('#') || value.startsWith('data:')) {
      continue;
    }
    if (REMOTE_URL_PATTERN.test(value)) {
      errors.push(`Remote popup asset is not allowed: ${value}`);
      continue;
    }
    if (value.startsWith('/') || value.includes('..')) {
      errors.push(`Popup asset must use a contained relative path: ${value}`);
      continue;
    }
    references.push(normalizeRelativePath(path.posix.join('popup', value)));
  }

  return references;
}

async function validateJsonFiles(root: string, files: string[], errors: string[]): Promise<void> {
  for (const file of files.filter((candidate) => candidate.endsWith('.json'))) {
    try {
      JSON.parse(await readFile(path.join(root, file), 'utf8'));
    } catch {
      errors.push(`Invalid packaged JSON: ${file}`);
    }
  }
}

export async function validateDist(distRoot: string): Promise<DistValidationResult> {
  const root = path.resolve(distRoot);
  const inspection = await collectFiles(root);
  const errors = [...inspection.errors];
  const files = inspection.files;
  const fileSet = new Set(files);

  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (FORBIDDEN_FILE_EXTENSIONS.has(extension) || file.split('/').includes('node_modules')) {
      errors.push(`Forbidden packaged artifact: ${file}`);
    }
  }

  for (const requiredFile of REQUIRED_SUPPORT_FILES) {
    if (!fileSet.has(requiredFile)) {
      errors.push(`Missing required packaged file: ${requiredFile}`);
    }
  }

  const manifestPath = path.join(root, 'manifest.json');
  if (!fileSet.has('manifest.json')) {
    errors.push('Missing required packaged file: manifest.json');
  } else {
    try {
      const manifestResult = await validatePackagedManifest(manifestPath, root);
      errors.push(...manifestResult.errors);
    } catch {
      errors.push('Invalid packaged JSON: manifest.json');
    }
  }

  if (fileSet.has('popup/popup.html')) {
    const popupHtml = await readFile(path.join(root, 'popup/popup.html'), 'utf8');
    for (const reference of collectPopupReferences(popupHtml, errors)) {
      const absoluteReference = path.resolve(root, reference);
      if (!isContainedPath(root, absoluteReference)) {
        errors.push(`Popup asset escapes dist: ${reference}`);
      } else if (!fileSet.has(reference)) {
        errors.push(`Missing popup asset: ${reference}`);
      }
    }
  }

  await validateJsonFiles(root, files, errors);

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    files,
  };
}

async function main(): Promise<void> {
  const distRoot = path.resolve(process.argv[2] ?? 'dist');
  const result = await validateDist(distRoot);

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${distRoot} (${result.files.length} packaged files).`);
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  await main();
}
