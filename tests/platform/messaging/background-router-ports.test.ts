import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';
import { UI_PORT_NAMES } from '@platform/messaging/message-contracts';

type ConnectListener = (port: unknown) => void;

function installRuntime() {
  let connectListener: ConnectListener | null = null;
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'syncnos-extension-id',
      onConnect: {
        addListener(listener: ConnectListener) {
          connectListener = listener;
        },
      },
      onMessage: {
        addListener: vi.fn(),
      },
    },
  });
  return {
    connect(port: unknown) {
      if (!connectListener) throw new Error('background router did not subscribe to runtime ports');
      connectListener(port);
    },
  };
}

function port(input: Readonly<{ name: string; senderId?: string; valid?: boolean }>) {
  const disconnect = vi.fn();
  const postMessage = vi.fn();
  const value = {
    name: input.name,
    sender: input.senderId === undefined ? {} : { id: input.senderId },
    disconnect,
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  return input.valid === false ? value : { ...value, postMessage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('background named Port registry', () => {
  it('accepts only own popup and local-data stream ports', () => {
    const runtime = installRuntime();
    const streamRouter = { registerPort: vi.fn(() => true) };
    const router = createBackgroundRouter({ fallback: () => null, localDataStreamRouter: streamRouter });
    const registerPopup = vi.spyOn(router.eventsHub, 'registerPort');
    router.start();

    const popup = port({ name: UI_PORT_NAMES.POPUP_EVENTS, senderId: 'syncnos-extension-id' });
    const stream = port({ name: UI_PORT_NAMES.LOCAL_DATA_STREAM, senderId: 'syncnos-extension-id' });
    runtime.connect(popup);
    runtime.connect(stream);

    expect(registerPopup).toHaveBeenCalledWith(popup);
    expect(streamRouter.registerPort).toHaveBeenCalledWith(stream);
    expect(popup.disconnect).not.toHaveBeenCalled();
    expect(stream.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects external, unknown, malformed, and rejected ports without registering them', () => {
    const runtime = installRuntime();
    const streamRouter = { registerPort: vi.fn(() => false) };
    const router = createBackgroundRouter({ fallback: () => null, localDataStreamRouter: streamRouter });
    const registerPopup = vi.spyOn(router.eventsHub, 'registerPort');
    router.start();

    const external = port({ name: UI_PORT_NAMES.POPUP_EVENTS, senderId: 'other-extension' });
    const unknown = port({ name: 'unrecognized:port', senderId: 'syncnos-extension-id' });
    const malformedPopup = port({ name: UI_PORT_NAMES.POPUP_EVENTS, senderId: 'syncnos-extension-id', valid: false });
    const popupWithoutDisconnect = {
      name: UI_PORT_NAMES.POPUP_EVENTS,
      sender: { id: 'syncnos-extension-id' },
      disconnect: vi.fn(),
      postMessage: vi.fn(),
    };
    const rejectedStream = port({ name: UI_PORT_NAMES.LOCAL_DATA_STREAM, senderId: 'syncnos-extension-id' });
    runtime.connect(external);
    runtime.connect(unknown);
    runtime.connect(malformedPopup);
    runtime.connect(popupWithoutDisconnect);
    runtime.connect(rejectedStream);

    expect(external.disconnect).toHaveBeenCalledOnce();
    expect(unknown.disconnect).toHaveBeenCalledOnce();
    expect(malformedPopup.disconnect).toHaveBeenCalledOnce();
    expect(popupWithoutDisconnect.disconnect).toHaveBeenCalledOnce();
    expect(rejectedStream.disconnect).toHaveBeenCalledOnce();
    expect(streamRouter.registerPort).toHaveBeenCalledTimes(1);
    expect(registerPopup).not.toHaveBeenCalled();
  });
});
