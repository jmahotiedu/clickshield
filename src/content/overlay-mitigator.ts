import type { SiteMode } from '../shared/settings.ts';
import type { OverlayAssessment, OverlayPosition, OverlaySnapshot } from './overlay-detector.ts';

export const CLICKSHIELD_OVERLAY_ATTRIBUTE = 'data-clickshield-overlay';
export const OVERLAY_REMOVAL_THRESHOLD = 95;

export type OverlayMitigationAction = 'none' | 'neutralized' | 'removed';

export interface OverlayStyleLike {
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
}

export interface OverlayParentLike {
  insertBefore(node: OverlayElementLike, reference: unknown | null): void;
  appendChild(node: OverlayElementLike): void;
}

export interface OverlayElementLike {
  readonly style: OverlayStyleLike;
  parentNode: OverlayParentLike | null;
  readonly nextSibling: unknown | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
}

interface MitigationRecord {
  action: Exclude<OverlayMitigationAction, 'none'>;
  pointerEventsValue: string;
  pointerEventsPriority: string;
  markerValue: string | null;
  parent: OverlayParentLike | null;
  nextSibling: unknown | null;
}

function restorePointerEvents(element: OverlayElementLike, record: MitigationRecord): void {
  if (record.pointerEventsValue.length === 0) {
    element.style.removeProperty('pointer-events');
    return;
  }

  element.style.setProperty(
    'pointer-events',
    record.pointerEventsValue,
    record.pointerEventsPriority,
  );
}

function restoreMarker(element: OverlayElementLike, record: MitigationRecord): void {
  if (record.markerValue === null) {
    element.removeAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE);
    return;
  }

  element.setAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE, record.markerValue);
}

export class OverlayMitigator {
  private readonly records = new Map<OverlayElementLike, MitigationRecord>();

  get size(): number {
    return this.records.size;
  }

  mitigate(
    element: OverlayElementLike,
    assessment: OverlayAssessment,
    mode: SiteMode,
  ): OverlayMitigationAction {
    if (mode !== 'strict' || assessment.recommendation !== 'mitigate') {
      return 'none';
    }

    const existing = this.records.get(element);
    if (existing !== undefined) {
      return existing.action;
    }

    const parent = element.parentNode;
    const nextSibling = element.nextSibling;
    const record: MitigationRecord = {
      action: 'neutralized',
      pointerEventsValue: element.style.getPropertyValue('pointer-events'),
      pointerEventsPriority: element.style.getPropertyPriority('pointer-events'),
      markerValue: element.getAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE),
      parent,
      nextSibling,
    };

    element.style.setProperty('pointer-events', 'none', 'important');
    element.setAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE, 'neutralized');

    if (assessment.confidence >= OVERLAY_REMOVAL_THRESHOLD) {
      record.action = 'removed';
      element.setAttribute(CLICKSHIELD_OVERLAY_ATTRIBUTE, 'removed');
      element.remove();
    }

    this.records.set(element, record);
    return record.action;
  }

  restore(element: OverlayElementLike): boolean {
    const record = this.records.get(element);
    if (record === undefined) {
      return false;
    }

    if (record.action === 'removed' && record.parent !== null) {
      try {
        record.parent.insertBefore(element, record.nextSibling);
      } catch {
        record.parent.appendChild(element);
      }
    }

    restorePointerEvents(element, record);
    restoreMarker(element, record);
    this.records.delete(element);
    return true;
  }

  restoreAll(): number {
    const elements = [...this.records.keys()];
    let restored = 0;

    for (const element of elements) {
      if (this.restore(element)) {
        restored += 1;
      }
    }

    return restored;
  }
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseZIndex(value: string): number | null {
  if (value === 'auto') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBackgroundAlpha(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'transparent') {
    return 0;
  }

  const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
  if (rgba !== null) {
    return Math.max(0, Math.min(1, parseNumber(rgba[1] ?? '1', 1)));
  }

  const modernRgba = normalized.match(/^rgb\([^/]+\/\s*([\d.]+)%?\)$/);
  if (modernRgba !== null) {
    const raw = parseNumber(modernRgba[1] ?? '1', 1);
    return normalized.includes('%') ? Math.max(0, Math.min(1, raw / 100)) : raw;
  }

  return 1;
}

function normalizePosition(value: string): OverlayPosition {
  switch (value.toLowerCase()) {
    case 'static':
    case 'relative':
    case 'absolute':
    case 'fixed':
    case 'sticky':
      return value.toLowerCase() as OverlayPosition;
    default:
      return 'other';
  }
}

function collectSemanticHints(element: Element): string[] {
  const values = [
    element.id,
    element.className,
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('data-testid') ?? '',
  ];

  return values
    .flatMap((value) =>
      String(value)
        .toLowerCase()
        .split(/[^a-z0-9-]+/),
    )
    .filter((value) => value.length > 0)
    .slice(0, 20);
}

function findIframeSource(element: Element): string | null {
  if (element instanceof HTMLIFrameElement) {
    return element.src || element.getAttribute('src');
  }

  const iframe = element.querySelector<HTMLIFrameElement>('iframe[src]');
  return iframe?.src ?? null;
}

export function createOverlaySnapshot(
  element: Element,
  timestamp: number,
  lastBlockedPopupTimestamp: number | null,
): OverlaySnapshot {
  const style = getComputedStyle(element);
  const rectangle = element.getBoundingClientRect();
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const interactiveDescendantCount = element.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [tabindex]',
  ).length;

  return {
    position: normalizePosition(style.position),
    viewportWidth: globalThis.innerWidth,
    viewportHeight: globalThis.innerHeight,
    width: rectangle.width,
    height: rectangle.height,
    zIndex: parseZIndex(style.zIndex),
    opacity: Math.max(0, Math.min(1, parseNumber(style.opacity, 1))),
    backgroundAlpha: parseBackgroundAlpha(style.backgroundColor),
    pointerEvents: style.pointerEvents,
    meaningfulTextLength: Math.min(text.length, 10_000),
    interactiveDescendantCount,
    iframeSource: findIframeSource(element),
    millisecondsSinceBlockedPopup:
      lastBlockedPopupTimestamp === null
        ? null
        : Math.max(0, timestamp - lastBlockedPopupTimestamp),
    role: element.getAttribute('role'),
    ariaModal: element.getAttribute('aria-modal') === 'true',
    semanticHints: collectSemanticHints(element),
  };
}
