import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBackgroundRouter } from '@platform/messaging/background-router';

const originalChrome = (globalThis as any).chrome;
const originalBrowser = (globalThis as any).browser;

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
});

describe('background router dispatch', () => {
  it('uses the same dispatch contract for direct and runtime messages', async () => {
    let listener: ((message: any, sender: any, sendResponse: (response: any) => void) => boolean) | null = null;
    (globalThis as any).chrome = {
      runtime: {
        onMessage: {
          addListener(next: typeof listener) {
            listener = next;
          },
        },
      },
    };
    (globalThis as any).browser = undefined;

    const router = createBackgroundRouter({
      fallback: (message) => router.err(`unknown message type: ${message?.type}`),
    });
    router.register('echo', (message, sender) => router.ok({ value: message.value, tabId: sender?.tab?.id ?? null }));
    router.start();

    const message = { type: 'echo', value: 7 };
    const sender = { tab: { id: 42 } };
    const direct = await router.dispatch(message, sender);
    const runtime = await new Promise((resolve) => {
      expect(listener).not.toBeNull();
      expect(listener!(message, sender, resolve)).toBe(true);
    });

    expect(runtime).toEqual(direct);
  });

  it('defaults sender to null and normalizes invalid, unknown and thrown handler errors', async () => {
    const fallback = vi.fn((message) => ({
      ok: false,
      data: null,
      error: { message: `unknown message type: ${message?.type}`, extra: null },
    }));
    const router = createBackgroundRouter({ fallback });
    router.register('sender', (_message, sender) => router.ok({ sender }));
    router.register('throw', () => {
      throw new Error('boom');
    });

    await expect(router.dispatch({ type: 'sender' })).resolves.toEqual(router.ok({ sender: null }));
    await expect(router.dispatch(null as any)).resolves.toEqual(router.err('invalid message'));
    await expect(router.dispatch({ type: 'missing' })).resolves.toEqual({
      ok: false,
      data: null,
      error: { message: 'unknown message type: missing', extra: null },
    });
    await expect(router.dispatch({ type: 'throw' })).resolves.toEqual(router.err('boom'));
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
