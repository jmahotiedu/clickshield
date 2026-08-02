import { BRIDGE_AUTH_TOKEN } from '../shared/bridge-auth.ts';
import { isSiteMode, type SiteMode } from '../shared/settings.ts';
import { hasOnlyKeys, isRecord } from '../shared/types.ts';

export const BRIDGE_BOOTSTRAP_MESSAGE = 'clickshield:bridge-bootstrap';
export const BRIDGE_READY_MESSAGE = 'clickshield:bridge-ready';
export const MODE_UPDATE_MESSAGE = 'clickshield:mode-update';
export const POPUP_ATTEMPT_MESSAGE = 'clickshield:popup-attempt';
const MAX_PENDING_ATTEMPTS = 20;

export interface SanitizedPopupAttempt {
  url: string;
  target: string | null;
  timestamp: number;
  blocked: boolean;
  approvedGesture: boolean;
  explicitNewContext: boolean;
  syntheticEvent: boolean;
}

export interface MainWorldBridge {
  publishPopupAttempt(attempt: SanitizedPopupAttempt): void;
  dispose(): void;
}

interface WindowMessageTargetLike {
  addEventListener(type: 'message', listener: EventListener): void;
  removeEventListener(type: 'message', listener: EventListener): void;
}

function isBootstrapMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'token']) &&
    value.type === BRIDGE_BOOTSTRAP_MESSAGE &&
    value.token === BRIDGE_AUTH_TOKEN
  );
}

export function isModeUpdateMessage(
  value: unknown,
): value is { type: typeof MODE_UPDATE_MESSAGE; mode: SiteMode } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'mode']) &&
    value.type === MODE_UPDATE_MESSAGE &&
    isSiteMode(value.mode)
  );
}

export function isSanitizedPopupAttempt(value: unknown): value is SanitizedPopupAttempt {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'url',
      'target',
      'timestamp',
      'blocked',
      'approvedGesture',
      'explicitNewContext',
      'syntheticEvent',
    ]) &&
    typeof value.url === 'string' &&
    (typeof value.target === 'string' || value.target === null) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    typeof value.blocked === 'boolean' &&
    typeof value.approvedGesture === 'boolean' &&
    typeof value.explicitNewContext === 'boolean' &&
    typeof value.syntheticEvent === 'boolean'
  );
}

export function isPopupAttemptMessage(
  value: unknown,
): value is { type: typeof POPUP_ATTEMPT_MESSAGE; attempt: SanitizedPopupAttempt } {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'attempt']) &&
    value.type === POPUP_ATTEMPT_MESSAGE &&
    isSanitizedPopupAttempt(value.attempt)
  );
}

export function installMainWorldBridge(
  target: WindowMessageTargetLike,
  onModeUpdate: (mode: SiteMode) => void,
): MainWorldBridge {
  let port: MessagePort | null = null;
  const pendingAttempts: SanitizedPopupAttempt[] = [];

  const handlePortMessage: EventListener = (event) => {
    const messageEvent = event as MessageEvent<unknown>;
    if (isModeUpdateMessage(messageEvent.data)) {
      onModeUpdate(messageEvent.data.mode);
    }
  };

  const handleBootstrap: EventListener = (event) => {
    const messageEvent = event as MessageEvent<unknown>;
    if (
      port !== null ||
      messageEvent.source !== target ||
      !isBootstrapMessage(messageEvent.data) ||
      messageEvent.ports.length !== 1
    ) {
      return;
    }

    port = messageEvent.ports[0] ?? null;
    if (port === null) {
      return;
    }

    target.removeEventListener('message', handleBootstrap);
    port.addEventListener('message', handlePortMessage);
    port.start();
    port.postMessage({ type: BRIDGE_READY_MESSAGE });

    for (const attempt of pendingAttempts.splice(0)) {
      port.postMessage({ type: POPUP_ATTEMPT_MESSAGE, attempt });
    }
  };

  target.addEventListener('message', handleBootstrap);

  return {
    publishPopupAttempt(attempt): void {
      if (port !== null) {
        port.postMessage({ type: POPUP_ATTEMPT_MESSAGE, attempt });
        return;
      }

      if (pendingAttempts.length < MAX_PENDING_ATTEMPTS) {
        pendingAttempts.push(attempt);
      }
    },
    dispose(): void {
      target.removeEventListener('message', handleBootstrap);
      if (port !== null) {
        port.removeEventListener('message', handlePortMessage);
        port.close();
        port = null;
      }
      pendingAttempts.length = 0;
    },
  };
}
