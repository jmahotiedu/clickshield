import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_RESOURCE_TYPES = new Set([
  'csp_report',
  'font',
  'image',
  'media',
  'object',
  'other',
  'ping',
  'script',
  'stylesheet',
  'sub_frame',
  'webbundle',
  'websocket',
  'xmlhttprequest',
]);

export interface RuleMetadataEntry {
  id?: unknown;
  path?: unknown;
  source?: unknown;
  license?: unknown;
  version?: unknown;
}

export interface RuleMetadataFile {
  formatVersion?: unknown;
  generatedDate?: unknown;
  rulesets?: unknown;
}

export interface RuleResource {
  id: string;
  path: string;
  rules: unknown;
}

export interface RulesetValidationResult {
  valid: boolean;
  errors: string[];
  ruleCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value);
}

function validateMetadata(
  metadata: RuleMetadataFile,
  resources: RuleResource[],
  errors: string[],
): void {
  if (metadata.formatVersion !== 1) {
    errors.push('filters/metadata.json formatVersion must equal 1.');
  }

  if (
    typeof metadata.generatedDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(metadata.generatedDate)
  ) {
    errors.push('filters/metadata.json generatedDate must use YYYY-MM-DD.');
  }

  if (!Array.isArray(metadata.rulesets)) {
    errors.push('filters/metadata.json rulesets must be an array.');
    return;
  }

  const entries = metadata.rulesets.filter(isRecord) as RuleMetadataEntry[];
  for (const resource of resources) {
    const entry = entries.find((candidate) => candidate.id === resource.id);
    if (entry === undefined) {
      errors.push(`Missing metadata for ruleset "${resource.id}".`);
      continue;
    }

    if (entry.path !== resource.path) {
      errors.push(`Metadata path for ruleset "${resource.id}" must equal "${resource.path}".`);
    }

    for (const field of ['source', 'license', 'version'] as const) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        errors.push(`Metadata field "${field}" is required for ruleset "${resource.id}".`);
      }
    }
  }
}

function validateRule(
  resourceId: string,
  rule: unknown,
  index: number,
  seenIds: Set<number>,
  errors: string[],
): void {
  const prefix = `${resourceId}[${index}]`;
  if (!isRecord(rule)) {
    errors.push(`${prefix} must be an object.`);
    return;
  }

  if (!isPositiveInteger(rule.id)) {
    errors.push(`${prefix}.id must be a positive integer.`);
  } else if (seenIds.has(rule.id)) {
    errors.push(`Duplicate rule id ${rule.id}.`);
  } else {
    seenIds.add(rule.id);
  }

  if (rule.priority !== undefined && !isPositiveInteger(rule.priority)) {
    errors.push(`${prefix}.priority must be a positive integer when present.`);
  }

  if (!isRecord(rule.action) || rule.action.type !== 'block') {
    errors.push(`${prefix}.action.type must equal "block".`);
  }

  if (!isRecord(rule.condition)) {
    errors.push(`${prefix}.condition must be an object.`);
    return;
  }

  const urlFilter = rule.condition.urlFilter;
  if (
    typeof urlFilter !== 'string' ||
    urlFilter.length === 0 ||
    !isAscii(urlFilter) ||
    urlFilter.startsWith('||*')
  ) {
    errors.push(`${prefix}.condition.urlFilter must be a supported non-empty ASCII filter.`);
  }

  const resourceTypes = rule.condition.resourceTypes;
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
    errors.push(`${prefix}.condition.resourceTypes must be a non-empty array.`);
    return;
  }

  for (const resourceType of resourceTypes) {
    if (typeof resourceType !== 'string' || !SUPPORTED_RESOURCE_TYPES.has(resourceType)) {
      errors.push(`${prefix} contains unsupported resource type "${String(resourceType)}".`);
    }
  }
}

export function validateRulesets(
  resources: RuleResource[],
  metadata: RuleMetadataFile,
): RulesetValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<number>();
  let ruleCount = 0;

  validateMetadata(metadata, resources, errors);

  for (const resource of resources) {
    if (!Array.isArray(resource.rules)) {
      errors.push(`${resource.path} must contain a JSON array.`);
      continue;
    }

    ruleCount += resource.rules.length;
    resource.rules.forEach((rule, index) => {
      validateRule(resource.id, rule, index, seenIds, errors);
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    ruleCount,
  };
}

export async function validateProjectRulesets(projectRoot: string): Promise<RulesetValidationResult> {
  const manifestPath = path.join(projectRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  const dnr = manifest.declarative_net_request;
  if (!isRecord(dnr) || !Array.isArray(dnr.rule_resources)) {
    return {
      valid: false,
      errors: ['manifest.json must declare declarative_net_request.rule_resources.'],
      ruleCount: 0,
    };
  }

  const resources: RuleResource[] = [];
  for (const rawResource of dnr.rule_resources) {
    if (
      !isRecord(rawResource) ||
      typeof rawResource.id !== 'string' ||
      typeof rawResource.path !== 'string'
    ) {
      return {
        valid: false,
        errors: ['Each declarative rule resource must provide string id and path values.'],
        ruleCount: 0,
      };
    }

    const rulesPath = path.join(projectRoot, rawResource.path);
    resources.push({
      id: rawResource.id,
      path: rawResource.path,
      rules: JSON.parse(await readFile(rulesPath, 'utf8')) as unknown,
    });
  }

  const metadata = JSON.parse(
    await readFile(path.join(projectRoot, 'filters/metadata.json'), 'utf8'),
  ) as RuleMetadataFile;

  return validateRulesets(resources, metadata);
}

async function main(): Promise<void> {
  const projectRoot = path.resolve(process.argv[2] ?? '.');
  const result = await validateProjectRulesets(projectRoot);

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${result.ruleCount} declarative network rules.`);
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  await main();
}
