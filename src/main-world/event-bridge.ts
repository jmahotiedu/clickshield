import { isSiteMode, type SiteMode } from '../shared/settings.ts';

export const MODE_UPDATE_EVENT = 'clickshield:mode-update';
export const POPUP_ATTEMPT_EVENT = 'clickshield:popup-attempt';

export interface SanitizedPopupAttempt {
  url: string;
  target: string | null;
  timestamp: number;
  blocked: boolean;
}

interface EventTargetLike {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSanitizedPopupAttempt(value: unknown): value is SanitizedPopupAttempt {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    (typeof value.target === 'string' || value.target === null) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    typeof value.blocked === 'boolean'
  );
}

export function publishModeUpdate(target: EventTargetLike, mode: SiteMode): void {
  target.dispatchEvent(new CustomEvent(MODE_UPDATE_EVENT, { detail: { mode } }));
}

export function listenForModeUpdates(
  target: EventTargetLike,
  listener: (mode: SiteMode) => void,
): () => void {
  const handleEvent: EventListener = (event) => {
    if (
      !(event instanceof CustomEvent) ||
      !isRecord(event.detail) ||
      !isSiteMode(event.detail.mode)
    ) {
      return;
    }

    listener(event.detail.mode);
  };

  target.addEventListener(MODE_UPDATE_EVENT, handleEvent);
  return () => target.removeEventListener(MODE_UPDATE_EVENT, handleEvent);
}

export function publishPopupAttempt(target: EventTargetLike, attempt: SanitizedPopupAttempt): void {
  target.dispatchEvent(new CustomEvent(POPUP_ATTEMPT_EVENT, { detail: attempt }));
}

export function listenForPopupAttempts(
  target: EventTargetLike,
  listener: (attempt: SanitizedPopupAttempt) => void,
): () => void {
  const handleEvent: EventListener = (event) => {
    if (!(event instanceof CustomEvent) || !isSanitizedPopupAttempt(event.detail)) {
      return;
    }

    listener(event.detail);
  };

  target.addEventListener(POPUP_ATTEMPT_EVENT, handleEvent);
  return () => target.removeEventListener(POPUP_ATTEMPT_EVENT, handleEvent);
}
