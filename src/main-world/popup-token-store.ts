export type MonotonicClock = () => number;

interface StoredToken<T> {
  value: T;
  expiresAt: number;
}

export class PopupTokenStore<T extends object> {
  private token: StoredToken<T> | null = null;

  public constructor(
    private readonly clock: MonotonicClock,
    private readonly ttlMs: number,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('Popup token lifetime must be a positive finite number.');
    }
  }

  public issue(value: T): void {
    this.token = {
      value,
      expiresAt: this.clock() + this.ttlMs,
    };
  }

  public consume(): T | null {
    const token = this.token;
    this.token = null;

    if (token === null || this.clock() > token.expiresAt) {
      return null;
    }

    return token.value;
  }

  public clear(): void {
    this.token = null;
  }
}
