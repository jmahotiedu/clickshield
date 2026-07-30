import { COSMETIC_STYLE_ATTRIBUTE } from './cosmetic-engine.ts';

export interface ElementLike {
  readonly nodeType: number;
  readonly name?: string;
  readonly parentElement: ElementLike | null;
  hasAttribute(name: string): boolean;
  querySelectorAll(selector: string): Iterable<ElementLike>;
}

export interface MutationRecordLike {
  readonly addedNodes: Iterable<unknown>;
}

export interface ObserverLike {
  observe(target: unknown, options?: { childList?: boolean; subtree?: boolean }): void;
  disconnect(): void;
}

export type MutationCallback = (records: MutationRecordLike[]) => void;
export type ObserverFactory = (callback: MutationCallback) => ObserverLike;

export interface BatchOptions {
  delayMs: number;
  maxNodes: number;
}

function isElementLike(value: unknown): value is ElementLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ElementLike>;
  return (
    candidate.nodeType === 1 &&
    typeof candidate.hasAttribute === 'function' &&
    typeof candidate.querySelectorAll === 'function' &&
    'parentElement' in candidate
  );
}

function isExtensionOwned(element: ElementLike): boolean {
  let current: ElementLike | null = element;

  while (current !== null) {
    if (current.hasAttribute(COSMETIC_STYLE_ATTRIBUTE)) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

export function collectAddedElements(
  records: Iterable<MutationRecordLike>,
  maxNodes: number,
): ElementLike[] {
  if (!Number.isInteger(maxNodes) || maxNodes <= 0) {
    return [];
  }

  const collected = new Set<ElementLike>();
  const addElement = (element: ElementLike): boolean => {
    if (collected.size >= maxNodes) {
      return false;
    }
    if (!isExtensionOwned(element)) {
      collected.add(element);
    }
    return collected.size < maxNodes;
  };

  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!isElementLike(node) || isExtensionOwned(node)) {
        continue;
      }

      if (!addElement(node)) {
        return [...collected];
      }

      for (const descendant of node.querySelectorAll('*')) {
        if (!isElementLike(descendant) || isExtensionOwned(descendant)) {
          continue;
        }
        if (!addElement(descendant)) {
          return [...collected];
        }
      }
    }
  }

  return [...collected];
}

export class BatchedMutationProcessor {
  private readonly pendingElements = new Set<ElementLike>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly process: (elements: ElementLike[]) => void,
    private readonly options: BatchOptions,
  ) {
    if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
      throw new Error('delayMs must be a non-negative finite number.');
    }
    if (!Number.isInteger(options.maxNodes) || options.maxNodes <= 0) {
      throw new Error('maxNodes must be a positive integer.');
    }
  }

  public enqueue(records: Iterable<MutationRecordLike>): void {
    for (const element of collectAddedElements(records, this.options.maxNodes)) {
      if (this.pendingElements.size >= this.options.maxNodes) {
        break;
      }
      this.pendingElements.add(element);
    }

    if (this.pendingElements.size === 0 || this.timer !== null) {
      return;
    }

    this.timer = setTimeout(() => this.flush(), this.options.delayMs);
  }

  public disconnect(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingElements.clear();
  }

  private flush(): void {
    this.timer = null;
    const elements = [...this.pendingElements];
    this.pendingElements.clear();

    if (elements.length > 0) {
      this.process(elements);
    }
  }
}

export class MutationObserverLifecycle {
  private observer: ObserverLike | null = null;

  public constructor(
    private readonly createObserver: ObserverFactory,
    private readonly callback: MutationCallback,
  ) {}

  public setEnabled(enabled: boolean, target: unknown): void {
    if (!enabled) {
      this.observer?.disconnect();
      this.observer = null;
      return;
    }

    if (this.observer !== null) {
      return;
    }

    this.observer = this.createObserver(this.callback);
    this.observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }
}
