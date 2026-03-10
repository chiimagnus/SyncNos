import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerCurrentPageCaptureContentHandlers } from '../../src/bootstrap/current-page-capture-content-handlers';

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('current-page-capture content handlers', () => {
  it('shows inpage tip progress when capture is triggered from context menu', async () => {
    let registeredListener: any = null;
    const addListener = vi.fn((listener: any) => {
      registeredListener = listener;
    });

    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener,
          removeListener: vi.fn(),
        },
      },
    };

    const captureCurrentPage = vi.fn(async (input?: any) => {
      input?.onProgress?.({ message: 'Saving...', kind: 'loading' });
      input?.onProgress?.({ message: 'Saved: Hello', kind: 'default' });
      return { title: 'Hello' };
    });

    const showSaveTip = vi.fn();

    registerCurrentPageCaptureContentHandlers(
      {
        // Not used in this test.
        getCurrentPageCaptureState: vi.fn(),
        captureCurrentPage,
      } as any,
      { inpageTip: { showSaveTip } },
    );

    expect(addListener).toHaveBeenCalledTimes(1);

    let response: any = null;
    const returned = registeredListener?.(
      { type: 'captureCurrentPage', payload: { source: 'contextmenu' } },
      {},
      (value: any) => {
        response = value;
      },
    );

    expect(returned).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(captureCurrentPage).toHaveBeenCalledTimes(1);
    expect(showSaveTip).toHaveBeenCalledWith('Saving...', { kind: 'loading' });
    expect(showSaveTip).toHaveBeenCalledWith('Saved: Hello', { kind: 'default' });
    expect(response?.ok).toBe(true);
    expect(response?.data).toEqual({ title: 'Hello' });
  });
});
