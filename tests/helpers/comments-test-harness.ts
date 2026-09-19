import { act } from 'react';
import type { Root } from 'react-dom/client';
import { vi } from 'vitest';

export async function flushCommentsReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    if (!vi.isFakeTimers() && typeof globalThis.requestAnimationFrame === 'function') {
      await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    }
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
      return;
    }
    await new Promise<void>((resolve) => {
      if (typeof setImmediate === 'function') setImmediate(resolve);
      else setTimeout(resolve, 0);
    });
    await Promise.resolve();
  });
}

export async function waitForCommentsUi<T>(
  callback: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  return vi.waitFor(callback, { timeout: 3000, interval: 20, ...options });
}

export async function cleanupCommentsReactRoot(root: Root | null): Promise<void> {
  if (root) {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  }
  await flushCommentsReactWork();
}

export const COMMENT_TEST_GROUPS = Object.freeze([
  'storage-and-domain',
  'sidebar-controller-and-session',
  'selection-and-locator',
  'threaded-panel-ui',
  'app-and-inpage-integration',
] as const);
