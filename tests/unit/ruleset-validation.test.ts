import { describe, expect, it } from 'vitest';

import {
  type RuleMetadataFile,
  type RuleResource,
  validateRulesets,
} from '../../tools/validate-rulesets.ts';

const metadata: RuleMetadataFile = {
  formatVersion: 1,
  generatedDate: '2026-07-30',
  rulesets: [
    {
      id: 'base',
      path: 'filters/declarative/base.json',
      source: 'ClickShield starter rules',
      license: 'CC0-1.0',
      version: '2026.07.30',
    },
  ],
};

function resourceWithRule(rule: Record<string, unknown>): RuleResource {
  return {
    id: 'base',
    path: 'filters/declarative/base.json',
    rules: [rule],
  };
}

function validRule(id: number): Record<string, unknown> {
  return {
    id,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||example-ad-network.com^',
      resourceTypes: ['script', 'sub_frame'],
    },
  };
}

describe('declarative ruleset validation', () => {
  it('accepts a valid packaged block ruleset', () => {
    expect(validateRulesets([resourceWithRule(validRule(1))], metadata)).toEqual({
      valid: true,
      errors: [],
      ruleCount: 1,
    });
  });

  it('rejects duplicate rule IDs across rulesets', () => {
    const resources: RuleResource[] = [
      resourceWithRule(validRule(1)),
      {
        id: 'tracking',
        path: 'filters/declarative/tracking.json',
        rules: [validRule(1)],
      },
    ];
    const duplicatedMetadata: RuleMetadataFile = {
      ...metadata,
      rulesets: [
        ...(metadata.rulesets as object[]),
        {
          id: 'tracking',
          path: 'filters/declarative/tracking.json',
          source: 'ClickShield starter rules',
          license: 'CC0-1.0',
          version: '2026.07.30',
        },
      ],
    };

    const result = validateRulesets(resources, duplicatedMetadata);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate rule id 1.');
  });

  it('rejects unsupported resource types', () => {
    const rule = validRule(1);
    rule.condition = {
      urlFilter: '||example-ad-network.com^',
      resourceTypes: ['main_frame'],
    };

    const result = validateRulesets([resourceWithRule(rule)], metadata);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('base[0] contains unsupported resource type "main_frame".');
  });

  it('rejects rulesets without source and license metadata', () => {
    const result = validateRulesets([resourceWithRule(validRule(1))], {
      formatVersion: 1,
      generatedDate: '2026-07-30',
      rulesets: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing metadata for ruleset "base".');
  });
});
