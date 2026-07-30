import { describe, expect, it } from 'vitest';

import {
  CLICKSHIELD_OVERLAY_ATTRIBUTE,
  OVERLAY_REMOVAL_THRESHOLD,
  OverlayMitigator,
  type OverlayElementLike,
  type OverlayParentLike,
  type OverlayStyleLike,
} from '../../src/content/overlay-mitigator.ts';
import type { OverlayAssessment } from '../../src/content/overlay-detector.ts';

class FakeStyle implements OverlayStyleLike {
  private readonly values = new Map<string, { value: string; priority: string }>();

  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? '';
  }

  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? '';
  }

  setProperty(name: string, value: string, priority = ''): void {
    this.values.set(name, { value, priority });
  }

  removeProperty(name: string): string {
    const previous = this.getPropertyValue(name);
    this.values.delete(name);
    return previous;
  }
}

class FakeParent implements OverlayParentLike {
  readonly children: FakeElement[] = [];

  insertBefore(node: OverlayElementLike, reference: unknown | null): void {
    const element = node as FakeElement;
    const index = reference === null ? -1 : this.children.indexOf(reference as FakeElement);
    if (index < 0) {
      this.children.push(element);
    } else {
      this.children.splice(index, 0, element);
    }
    element.parentNode = this;
  }

  appendChild(node: OverlayElementLike): void {
    const element = node as FakeElement;
    this.children.push(element);
    element.parentNode = this;
  }
}

class FakeElement implements OverlayElementLike {
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  parentNode: FakeParent | null = null;
  nextSibling: FakeElement | null = null;
  removed = false;

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  remove(): void {
    this.removed = true;
    if (this.parentNode !== null) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) {
        this.parentNode.children.splice(index, 1);
      }
    }
    this.parentNode = null;
  }
}

function assessment(confidence = 80): OverlayAssessment {
  return {
    recommendation: 'mitigate',
    confidence,
    positiveSignals: 5,
    reasons: ['positioned-over-content', 'large-viewport-coverage', 'pointer-interception'],
  };
}

describe('overlay mitigator', () => {
  it('does nothing outside Strict mode', () => {
    const element = new FakeElement();
    element.style.setProperty('pointer-events', 'auto');
    const mitigator = new OverlayMitigator();

    expect(mitigator.mitigate(element, assessment(), 'standard')).toBe('none');
    expect(element.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(element.hasAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE)).toBe(false);
  });

  it('first disables pointer interception and preserves the original inline value', () => {
    const element = new FakeElement();
    element.style.setProperty('pointer-events', 'auto', 'important');
    const mitigator = new OverlayMitigator();

    expect(mitigator.mitigate(element, assessment(), 'strict')).toBe('neutralized');
    expect(element.style.getPropertyValue('pointer-events')).toBe('none');
    expect(element.style.getPropertyPriority('pointer-events')).toBe('important');
    expect(element.getAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE)).toBe('neutralized');

    expect(mitigator.restore(element)).toBe(true);
    expect(element.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(element.style.getPropertyPriority('pointer-events')).toBe('important');
    expect(element.hasAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE)).toBe(false);
  });

  it('is idempotent when the same element is processed repeatedly', () => {
    const element = new FakeElement();
    const mitigator = new OverlayMitigator();

    expect(mitigator.mitigate(element, assessment(), 'strict')).toBe('neutralized');
    expect(mitigator.mitigate(element, assessment(), 'strict')).toBe('neutralized');
    expect(mitigator.size).toBe(1);
  });

  it('removes only above the higher removal threshold and can reinsert the element', () => {
    const parent = new FakeParent();
    const element = new FakeElement();
    const sibling = new FakeElement();
    parent.appendChild(element);
    parent.appendChild(sibling);
    element.nextSibling = sibling;
    const mitigator = new OverlayMitigator();

    expect(mitigator.mitigate(element, assessment(OVERLAY_REMOVAL_THRESHOLD), 'strict')).toBe(
      'removed',
    );
    expect(element.removed).toBe(true);
    expect(parent.children).toEqual([sibling]);

    expect(mitigator.restore(element)).toBe(true);
    expect(parent.children).toEqual([element, sibling]);
    expect(element.style.getPropertyValue('pointer-events')).toBe('');
  });

  it('restores every mitigated element when protection is turned off', () => {
    const first = new FakeElement();
    const second = new FakeElement();
    const mitigator = new OverlayMitigator();

    mitigator.mitigate(first, assessment(), 'strict');
    mitigator.mitigate(second, assessment(), 'strict');
    expect(mitigator.size).toBe(2);

    expect(mitigator.restoreAll()).toBe(2);
    expect(mitigator.size).toBe(0);
    expect(first.style.getPropertyValue('pointer-events')).toBe('');
    expect(second.style.getPropertyValue('pointer-events')).toBe('');
  });
});
