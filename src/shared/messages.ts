import { isSiteMode, type SiteMode } from './settings.ts';
import { hasOnlyKeys, isFiniteNumber, isRecord } from './types.ts';

export interface ModifierState {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export interface ClickContextMessage {
  type: 'click-context';
  payload: {
    timestamp: number;
    button: 0 | 1 | 2;
    modifiers: ModifierState;
    trusted: boolean;
    href: string | null;
    targetBlank: boolean;
  };
}

export interface PopupAttemptMessage {
  type: 'popup-attempt';
  payload: {
    url: string;
    target: string | null;
    timestamp: number;
    blocked: boolean;
    approvedGesture: boolean;
    explicitNewContext: boolean;
    syntheticEvent: boolean;
  };
}

export interface BlockedActionMessage {
  type: 'blocked-action';
  payload: {
    category: 'popup' | 'overlay' | 'network' | 'cosmetic';
    reason: string;
    tabId?: number;
  };
}

export interface SettingsRequestMessage {
  type: 'settings-request';
  payload:
    | {
        operation: 'get';
        hostname: string;
      }
    | {
        operation: 'set';
        hostname: string;
        mode: SiteMode;
      };
}

export interface StatisticsUpdateMessage {
  type: 'statistics-update';
  payload: {
    tabId: number;
    blockedRequests: number;
    hiddenElements: number;
  };
}

export interface RecentBlockedPopupMessage {
  type: 'recent-blocked-popup';
  payload: {
    timestamp: number;
  };
}

export interface LearnDenyHostMessage {
  type: 'learn-deny-host';
  payload: {
    hostname: string;
    tabId?: number;
    closeTab?: boolean;
  };
}

export type ExtensionMessage =
  | ClickContextMessage
  | PopupAttemptMessage
  | BlockedActionMessage
  | SettingsRequestMessage
  | StatisticsUpdateMessage
  | RecentBlockedPopupMessage
  | LearnDenyHostMessage;

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isModifierState(value: unknown): value is ModifierState {
  if (!isRecord(value) || !hasOnlyKeys(value, ['alt', 'ctrl', 'meta', 'shift'])) {
    return false;
  }

  return (
    isBoolean(value.alt) && isBoolean(value.ctrl) && isBoolean(value.meta) && isBoolean(value.shift)
  );
}

function isClickContextPayload(value: unknown): value is ClickContextMessage['payload'] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['timestamp', 'button', 'modifiers', 'trusted', 'href', 'targetBlank'])
  ) {
    return false;
  }

  return (
    isFiniteNumber(value.timestamp) &&
    (value.button === 0 || value.button === 1 || value.button === 2) &&
    isModifierState(value.modifiers) &&
    isBoolean(value.trusted) &&
    isStringOrNull(value.href) &&
    isBoolean(value.targetBlank)
  );
}

function isPopupAttemptPayload(value: unknown): value is PopupAttemptMessage['payload'] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'url',
      'target',
      'timestamp',
      'blocked',
      'approvedGesture',
      'explicitNewContext',
      'syntheticEvent',
    ])
  ) {
    return false;
  }

  return (
    typeof value.url === 'string' &&
    isStringOrNull(value.target) &&
    isFiniteNumber(value.timestamp) &&
    isBoolean(value.blocked) &&
    isBoolean(value.approvedGesture) &&
    isBoolean(value.explicitNewContext) &&
    isBoolean(value.syntheticEvent)
  );
}

function isBlockedActionPayload(value: unknown): value is BlockedActionMessage['payload'] {
  if (!isRecord(value) || !hasOnlyKeys(value, ['category', 'reason', 'tabId'])) {
    return false;
  }

  const categoryIsValid =
    value.category === 'popup' ||
    value.category === 'overlay' ||
    value.category === 'network' ||
    value.category === 'cosmetic';
  const tabIdIsValid = value.tabId === undefined || isNonNegativeInteger(value.tabId);

  return categoryIsValid && typeof value.reason === 'string' && tabIdIsValid;
}

function isSettingsRequestPayload(value: unknown): value is SettingsRequestMessage['payload'] {
  if (!isRecord(value) || typeof value.hostname !== 'string') {
    return false;
  }

  if (value.operation === 'get') {
    return hasOnlyKeys(value, ['operation', 'hostname']);
  }

  if (value.operation === 'set') {
    return hasOnlyKeys(value, ['operation', 'hostname', 'mode']) && isSiteMode(value.mode);
  }

  return false;
}

function isStatisticsUpdatePayload(value: unknown): value is StatisticsUpdateMessage['payload'] {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tabId', 'blockedRequests', 'hiddenElements'])) {
    return false;
  }

  return (
    isNonNegativeInteger(value.tabId) &&
    isNonNegativeInteger(value.blockedRequests) &&
    isNonNegativeInteger(value.hiddenElements)
  );
}

function isRecentBlockedPopupPayload(
  value: unknown,
): value is RecentBlockedPopupMessage['payload'] {
  return isRecord(value) && hasOnlyKeys(value, ['timestamp']) && isFiniteNumber(value.timestamp);
}

function isLearnDenyHostPayload(value: unknown): value is LearnDenyHostMessage['payload'] {
  if (!isRecord(value) || typeof value.hostname !== 'string') {
    return false;
  }

  const tabIdOk = value.tabId === undefined || isNonNegativeInteger(value.tabId);
  const closeOk = value.closeTab === undefined || isBoolean(value.closeTab);
  if (!tabIdOk || !closeOk) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.every((key) => key === 'hostname' || key === 'tabId' || key === 'closeTab');
}

export function isRecentBlockedPopupMessage(value: unknown): value is RecentBlockedPopupMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'payload']) &&
    value.type === 'recent-blocked-popup' &&
    isRecentBlockedPopupPayload(value.payload)
  );
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value) || !hasOnlyKeys(value, ['type', 'payload'])) {
    return false;
  }

  switch (value.type) {
    case 'click-context':
      return isClickContextPayload(value.payload);
    case 'popup-attempt':
      return isPopupAttemptPayload(value.payload);
    case 'blocked-action':
      return isBlockedActionPayload(value.payload);
    case 'settings-request':
      return isSettingsRequestPayload(value.payload);
    case 'statistics-update':
      return isStatisticsUpdatePayload(value.payload);
    case 'recent-blocked-popup':
      return isRecentBlockedPopupPayload(value.payload);
    case 'learn-deny-host':
      return isLearnDenyHostPayload(value.payload);
    default:
      return false;
  }
}
