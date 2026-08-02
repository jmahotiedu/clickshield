import { describe, expect, it, vi } from 'vitest';

import { BRIDGE_AUTH_TOKEN } from '../../src/shared/bridge-auth.ts';
import {
  BRIDGE_BOOTSTRAP_MESSAGE,
  BRIDGE_READY_MESSAGE,
  MODE_UPDATE_MESSAGE,
  POPUP_ATTEMPT_MESSAGE,
  installMainWorldBridge,
  type SanitizedPopupAttempt,
} from '../../src/main-world/event-bridge.ts';

class FakePort {
  private readonly listeners = new Set<EventListener>();
  peer: FakePort | null = null;
  closed = false;

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  postMessage(message: unknown): void {
    if (!this.closed) {
      this.peer?.emit(message);
    }
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }

  private emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class FakeWindowTarget {
  private readonly listeners = new Set<EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  emitMessage(data: unknown, ports: MessagePort[] = [], source: unknown = this): void {
    const event = { data, ports, source } as unknown as MessageEvent<unknown>;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

function createPortPair(): [FakePort, FakePort] {
  const first = new FakePort();
  const second = new FakePort();
  first.peer = second;
  second.peer = first;
  return [first, second];
}

const attempt: SanitizedPopupAttempt = {
  url: 'https://ads.example/popup',
  target: '_blank',
  timestamp: 10,
  blocked: true,
  approvedGesture: false,
  explicitNewContext: false,
  syntheticEvent: false,
};

describe('authenticated MAIN-world bridge', () => {
  it('accepts mode updates only from the transferred private port', () => {
    const target = new FakeWindowTarget();
    const onModeUpdate = vi.fn();
    const [isolatedPort, mainPort] = createPortPair();
    const receivedByIsolated: unknown[] = [];
    isolatedPort.addEventListener('message', ((event: MessageEvent<unknown>) => {
      receivedByIsolated.push(event.data);
    }) as EventListener);

    const bridge = installMainWorldBridge(target, onModeUpdate);
    target.emitMessage(
      { type: BRIDGE_BOOTSTRAP_MESSAGE, token: BRIDGE_AUTH_TOKEN },
      [mainPort as unknown as MessagePort],
      target,
    );

    expect(receivedByIsolated).toContainEqual({ type: BRIDGE_READY_MESSAGE });

    isolatedPort.postMessage({ type: MODE_UPDATE_MESSAGE, mode: 'strict' });
    expect(onModeUpdate).toHaveBeenLastCalledWith('strict');

    target.emitMessage({ type: MODE_UPDATE_MESSAGE, mode: 'off' });
    expect(onModeUpdate).toHaveBeenCalledTimes(1);

    bridge.publishPopupAttempt(attempt);
    expect(receivedByIsolated).toContainEqual({ type: POPUP_ATTEMPT_MESSAGE, attempt });
  });

  it('rejects bootstrap messages that do not originate from the guarded window', () => {
    const target = new FakeWindowTarget();
    const onModeUpdate = vi.fn();
    const [isolatedPort, mainPort] = createPortPair();

    installMainWorldBridge(target, onModeUpdate);
    target.emitMessage(
      { type: BRIDGE_BOOTSTRAP_MESSAGE, token: BRIDGE_AUTH_TOKEN },
      [mainPort as unknown as MessagePort],
      {},
    );
    isolatedPort.postMessage({ type: MODE_UPDATE_MESSAGE, mode: 'off' });

    expect(onModeUpdate).not.toHaveBeenCalled();
  });

  it('rejects bootstrap messages without the extension auth token', () => {
    const target = new FakeWindowTarget();
    const onModeUpdate = vi.fn();
    const [isolatedPort, mainPort] = createPortPair();

    installMainWorldBridge(target, onModeUpdate);
    target.emitMessage(
      { type: BRIDGE_BOOTSTRAP_MESSAGE },
      [mainPort as unknown as MessagePort],
      target,
    );
    isolatedPort.postMessage({ type: MODE_UPDATE_MESSAGE, mode: 'off' });

    expect(onModeUpdate).not.toHaveBeenCalled();
  });

  it('rejects a second same-window bootstrap after the authenticated port connects', () => {
    const target = new FakeWindowTarget();
    const onModeUpdate = vi.fn();
    const [isolatedPort, mainPort] = createPortPair();
    const [hostileIsolatedPort, hostileMainPort] = createPortPair();

    installMainWorldBridge(target, onModeUpdate);
    target.emitMessage(
      { type: BRIDGE_BOOTSTRAP_MESSAGE, token: BRIDGE_AUTH_TOKEN },
      [mainPort as unknown as MessagePort],
      target,
    );
    isolatedPort.postMessage({ type: MODE_UPDATE_MESSAGE, mode: 'strict' });

    target.emitMessage(
      { type: BRIDGE_BOOTSTRAP_MESSAGE, token: BRIDGE_AUTH_TOKEN },
      [hostileMainPort as unknown as MessagePort],
      target,
    );
    hostileIsolatedPort.postMessage({ type: MODE_UPDATE_MESSAGE, mode: 'off' });

    expect(onModeUpdate).toHaveBeenCalledTimes(1);
    expect(onModeUpdate).toHaveBeenLastCalledWith('strict');
  });
});
