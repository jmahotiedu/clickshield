const STORAGE_KEY = Symbol.for('clickshield.blockedPopupTimestamp');

interface SignalHolder {
  [STORAGE_KEY]?: number | null;
}

export function recordBlockedPopupTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp)) {
    return;
  }

  (globalThis as SignalHolder)[STORAGE_KEY] = timestamp;
}

export function getLastBlockedPopupTimestamp(): number | null {
  const value = (globalThis as SignalHolder)[STORAGE_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function clearBlockedPopupTimestamp(): void {
  (globalThis as SignalHolder)[STORAGE_KEY] = null;
}
