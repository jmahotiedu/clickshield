import type { PopupTokenStore } from './popup-token-store.ts';

export type GestureSource = 'pointer' | 'keyboard';

export interface GestureEventRecord {
  kind: GestureSource;
  trusted: boolean;
  timestamp: number;
  button: number | null;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string | null;
  href: string | null;
}

export interface InterpretedGesture {
  approved: boolean;
  explicitNewContext: boolean;
  synthetic: boolean;
  source: GestureSource;
  timestamp: number;
  href: string | null;
}

export interface ApprovedPopupGesture {
  explicitNewContext: boolean;
  source: GestureSource;
  timestamp: number;
  href: string | null;
}

interface EventTargetLike {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions): void;
}

function isKeyboardActivation(record: GestureEventRecord): boolean {
  return record.kind === 'keyboard' && (record.key === 'Enter' || record.key === ' ');
}

function isApprovedPointer(record: GestureEventRecord): boolean {
  return record.kind === 'pointer' && (record.button === 0 || record.button === 1);
}

export function interpretTrustedGesture(record: GestureEventRecord): InterpretedGesture {
  const synthetic = !record.trusted;
  const approved = !synthetic && (isApprovedPointer(record) || isKeyboardActivation(record));
  const explicitNewContext =
    approved &&
    record.kind === 'pointer' &&
    (record.button === 1 || record.ctrlKey || record.metaKey || record.shiftKey);

  return {
    approved,
    explicitNewContext,
    synthetic,
    source: record.kind,
    timestamp: record.timestamp,
    href: record.href,
  };
}

function findHref(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest<HTMLAnchorElement | HTMLAreaElement>('a[href], area[href]');
  return link?.href ?? null;
}

function toPointerRecord(event: MouseEvent): GestureEventRecord {
  return {
    kind: 'pointer',
    trusted: event.isTrusted,
    timestamp: performance.now(),
    button: event.button,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    key: null,
    href: findHref(event.target),
  };
}

function toKeyboardRecord(event: KeyboardEvent): GestureEventRecord {
  return {
    kind: 'keyboard',
    trusted: event.isTrusted,
    timestamp: performance.now(),
    button: null,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    key: event.key,
    href: findHref(event.target),
  };
}

function issueApprovedGesture(
  record: GestureEventRecord,
  tokenStore: PopupTokenStore<ApprovedPopupGesture>,
): void {
  const gesture = interpretTrustedGesture(record);
  if (!gesture.approved) {
    return;
  }

  tokenStore.issue({
    explicitNewContext: gesture.explicitNewContext,
    source: gesture.source,
    timestamp: gesture.timestamp,
    href: gesture.href,
  });
}

export function installTrustedGestureTracker(
  target: EventTargetLike,
  tokenStore: PopupTokenStore<ApprovedPopupGesture>,
): () => void {
  const handleClick: EventListener = (event) => {
    if (event instanceof MouseEvent) {
      issueApprovedGesture(toPointerRecord(event), tokenStore);
    }
  };
  const handleKeydown: EventListener = (event) => {
    if (event instanceof KeyboardEvent) {
      issueApprovedGesture(toKeyboardRecord(event), tokenStore);
    }
  };
  const options: AddEventListenerOptions = { capture: true, passive: true };

  target.addEventListener('click', handleClick, options);
  target.addEventListener('auxclick', handleClick, options);
  target.addEventListener('keydown', handleKeydown, options);

  return () => {
    target.removeEventListener('click', handleClick, { capture: true });
    target.removeEventListener('auxclick', handleClick, { capture: true });
    target.removeEventListener('keydown', handleKeydown, { capture: true });
    tokenStore.clear();
  };
}
