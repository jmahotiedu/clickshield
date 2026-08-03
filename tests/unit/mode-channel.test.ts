import { describe, expect, it } from 'vitest';

import { resolveTopLevelPolicyUrl } from '../../src/content/mode-channel.ts';

function origins(values: string[]): DOMStringList {
  return {
    length: values.length,
    contains(value: string): boolean {
      return values.includes(value);
    },
    item(index: number): string | null {
      return values[index] ?? null;
    },
    [Symbol.iterator](): ArrayIterator<string> {
      return values[Symbol.iterator]();
    },
  } as DOMStringList;
}

describe('all-frame mode channel', () => {
  it('uses the current URL in the top-level frame', () => {
    expect(
      resolveTopLevelPolicyUrl({
        location: {
          href: 'https://player.example/watch',
          ancestorOrigins: origins([]),
        },
      }),
    ).toBe('https://player.example/watch');
  });

  it('uses the outermost ancestor origin inside a third-party frame', () => {
    expect(
      resolveTopLevelPolicyUrl({
        location: {
          href: 'https://frame.example/embed',
          ancestorOrigins: origins(['https://middle.example', 'https://player.example']),
        },
      }),
    ).toBe('https://player.example');
  });
});
