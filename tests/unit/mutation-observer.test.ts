import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BatchedMutationProcessor,
  collectAddedElements,
  MutationObserverLifecycle,
  type ElementLike,
  type MutationRecordLike,
  type ObserverLike,
} from '../../src/content/mutation-observer.ts';

class FakeElement implements ElementLike {
  public readonly nodeType = 1;
  public parentElement: ElementLike | null = null;
  private readonly attributes = new Set<string>();

  public constructor(
    public readonly name: string,
    private readonly descendants: FakeElement[] = [],
  ) {
    descendants.forEach((element) => {
      element.parentElement = this;
    });
  }

  public markOwned(): void {
    this.attributes.add('data-clickshield-owned');
  }

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  public querySelectorAll(selector: string): Iterable<ElementLike> {
    return selector === '*' ? this.descendants : [];
  }
}

function record(...elements: FakeElement[]): MutationRecordLike {
  return { addedNodes: elements };
}

describe('mutation collection', () => {
  it('collects added elements and descendants without rescanning the document', () => {
    const child = new FakeElement('child');
    const root = new FakeElement('root', [child]);

    expect(collectAddedElements([record(root)], 10).map((element) => element.name)).toEqual([
      'root',
      'child',
    ]);
  });

  it('ignores extension-owned elements and their descendants', () => {
    const ownedChild = new FakeElement('owned-child');
    const ownedRoot = new FakeElement('style', [ownedChild]);
    ownedRoot.markOwned();

    expect(collectAddedElements([record(ownedRoot)], 10)).toEqual([]);
  });

  it('bounds collected nodes', () => {
    const root = new FakeElement(
      'root',
      Array.from({ length: 20 }, (_, index) => new FakeElement(`child-${index}`)),
    );

    expect(collectAddedElements([record(root)], 5)).toHaveLength(5);
  });
});

describe('batched mutation processing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple mutation deliveries into one processing pass', () => {
    const processed: string[][] = [];
    const processor = new BatchedMutationProcessor(
      (elements) => processed.push(elements.map((element) => element.name)),
      { delayMs: 25, maxNodes: 20 },
    );

    processor.enqueue([record(new FakeElement('first'))]);
    processor.enqueue([record(new FakeElement('second'))]);

    vi.advanceTimersByTime(24);
    expect(processed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(processed).toEqual([['first', 'second']]);
  });

  it('cancels pending work when disconnected', () => {
    const process = vi.fn();
    const processor = new BatchedMutationProcessor(process, { delayMs: 25, maxNodes: 20 });

    processor.enqueue([record(new FakeElement('ad'))]);
    processor.disconnect();
    vi.runAllTimers();

    expect(process).not.toHaveBeenCalled();
  });
});

describe('observer lifecycle', () => {
  it('disconnects in Off mode and reconnects when protection is enabled', () => {
    const observers: Array<ObserverLike & { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const lifecycle = new MutationObserverLifecycle(
      () => {
        const observer = {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
        observers.push(observer);
        return observer;
      },
      () => undefined,
    );
    const target = {};

    lifecycle.setEnabled(true, target);
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledOnce();

    lifecycle.setEnabled(false, target);
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce();

    lifecycle.setEnabled(true, target);
    expect(observers).toHaveLength(2);
  });
});
