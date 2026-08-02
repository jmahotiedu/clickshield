import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManifestContentScript {
  matches?: unknown;
  js?: unknown;
  run_at?: unknown;
  world?: unknown;
  all_frames?: unknown;
  match_about_blank?: unknown;
  match_origin_as_fallback?: unknown;
}

export interface ExtensionManifest {
  manifest_version?: unknown;
  name?: unknown;
  version?: unknown;
  background?: unknown;
  action?: unknown;
  content_scripts?: unknown;
  declarative_net_request?: unknown;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  referencedFiles: string[];
}

const REMOTE_URL_PATTERN = /^https?:\/\//i;
const ALL_FRAME_PROTECTION_SCRIPTS = new Set([
  'main-world/popup-guard.js',
  'content/mode-channel.js',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRelativeExtensionPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !REMOTE_URL_PATTERN.test(value) &&
    !value.startsWith('/') &&
    !value.includes('..')
  );
}

function collectScriptPaths(contentScripts: unknown, errors: string[]): string[] {
  if (!Array.isArray(contentScripts) || contentScripts.length === 0) {
    errors.push('content_scripts must contain at least one entry.');
    return [];
  }

  const paths: string[] = [];

  contentScripts.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`content_scripts[${index}] must be an object.`);
      return;
    }

    if (!Array.isArray(entry.matches) || entry.matches.length === 0) {
      errors.push(`content_scripts[${index}].matches must be a non-empty array.`);
    }

    if (!Array.isArray(entry.js) || entry.js.length === 0) {
      errors.push(`content_scripts[${index}].js must be a non-empty array.`);
      return;
    }

    entry.js.forEach((scriptPath, scriptIndex) => {
      if (!isRelativeExtensionPath(scriptPath)) {
        errors.push(`content_scripts[${index}].js[${scriptIndex}] must be a local relative path.`);
        return;
      }

      if (ALL_FRAME_PROTECTION_SCRIPTS.has(scriptPath) && entry.all_frames !== true) {
        errors.push(`${scriptPath} must set all_frames to true.`);
      }

      if (ALL_FRAME_PROTECTION_SCRIPTS.has(scriptPath) && entry.match_about_blank !== true) {
        errors.push(`${scriptPath} must set match_about_blank to true.`);
      }

      if (ALL_FRAME_PROTECTION_SCRIPTS.has(scriptPath) && entry.match_origin_as_fallback !== true) {
        errors.push(`${scriptPath} must set match_origin_as_fallback to true.`);
      }

      paths.push(scriptPath);
    });
  });

  for (const requiredScript of ALL_FRAME_PROTECTION_SCRIPTS) {
    if (!paths.includes(requiredScript)) {
      errors.push(`Missing required protection script: ${requiredScript}`);
    }
  }

  return paths;
}

function collectRuleResourcePaths(value: unknown, errors: string[]): string[] {
  if (!isRecord(value) || !Array.isArray(value.rule_resources)) {
    errors.push('declarative_net_request.rule_resources must be an array.');
    return [];
  }

  const ids = new Set<string>();
  const paths: string[] = [];
  value.rule_resources.forEach((resource, index) => {
    if (!isRecord(resource)) {
      errors.push(`declarative_net_request.rule_resources[${index}] must be an object.`);
      return;
    }

    if (typeof resource.id !== 'string' || resource.id.length === 0) {
      errors.push(`declarative_net_request.rule_resources[${index}].id must be a string.`);
    } else if (ids.has(resource.id)) {
      errors.push(`Duplicate declarative rule resource id "${resource.id}".`);
    } else {
      ids.add(resource.id);
    }

    if (!isRelativeExtensionPath(resource.path)) {
      errors.push(
        `declarative_net_request.rule_resources[${index}].path must be a local relative path.`,
      );
      return;
    }

    paths.push(resource.path);
  });

  return paths;
}

export function validateManifest(manifest: ExtensionManifest): ManifestValidationResult {
  const errors: string[] = [];
  const referencedFiles: string[] = [];

  if (manifest.manifest_version !== 3) {
    errors.push('manifest_version must equal 3.');
  }

  if (typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    errors.push('name must be a non-empty string.');
  }

  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    errors.push('version must use numeric major.minor.patch format.');
  }

  if (!isRecord(manifest.background)) {
    errors.push('background must be an object.');
  } else if (!isRelativeExtensionPath(manifest.background.service_worker)) {
    errors.push('background.service_worker must be a local relative path.');
  } else {
    referencedFiles.push(manifest.background.service_worker);
  }

  if (!isRecord(manifest.action)) {
    errors.push('action must be an object.');
  } else if (!isRelativeExtensionPath(manifest.action.default_popup)) {
    errors.push('action.default_popup must be a local relative path.');
  } else {
    referencedFiles.push(manifest.action.default_popup);
  }

  referencedFiles.push(...collectScriptPaths(manifest.content_scripts, errors));
  referencedFiles.push(...collectRuleResourcePaths(manifest.declarative_net_request, errors));

  return {
    valid: errors.length === 0,
    errors,
    referencedFiles: [...new Set(referencedFiles)].sort(),
  };
}

export async function validatePackagedManifest(
  manifestPath: string,
  packageRoot = path.dirname(manifestPath),
): Promise<ManifestValidationResult> {
  const rawManifest = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(rawManifest) as ExtensionManifest;
  const result = validateManifest(manifest);

  for (const referencedFile of result.referencedFiles) {
    try {
      await access(path.join(packageRoot, referencedFile));
    } catch {
      result.errors.push(`Missing packaged file: ${referencedFile}`);
    }
  }

  return {
    ...result,
    valid: result.errors.length === 0,
  };
}

async function main(): Promise<void> {
  const manifestPath = path.resolve(process.argv[2] ?? 'manifest.json');
  const packageRoot = path.resolve(process.argv[3] ?? path.dirname(manifestPath));
  const result = await validatePackagedManifest(manifestPath, packageRoot);

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${manifestPath} (${result.referencedFiles.length} referenced files).`);
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  await main();
}
