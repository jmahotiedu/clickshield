import { describe, expect, it } from 'vitest';

import { EXTENSION_NAME } from '../../src/shared/project.ts';

describe('project workspace', () => {
  it('exposes the extension name', () => {
    expect(EXTENSION_NAME).toBe('ClickShield');
  });
});
