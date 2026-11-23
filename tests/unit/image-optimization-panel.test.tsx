// @vitest-environment jsdom
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const batch = vi.hoisted(() => ({ current: {} as any, start: vi.fn(), cancel: vi.fn() }));
vi.mock('@viewmodels/settings/useStorageImageBatch', () => ({
  useStorageImageBatch: () => batch.current,
}));
import { ImageOptimizationPanel } from '@ui/settings/sections/ImageOptimizationPanel';

let root: ReactDOM.Root;
const createUrl = vi.fn();
const asset = (id: number, format: string, animation: string) => ({
  id,
  conversationId: 1,
  readable: true,
  orphan: false,
  format,
  animation,
  bytes: 120,
  url: `image-${id}`,
});
const assets = [
  asset(1, 'png', 'static'),
  asset(2, 'jpeg', 'static'),
  asset(3, 'apng', 'static'),
  asset(4, 'gif', 'animated'),
] as any[];

function render(valid = true) {
  act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: valid })));
}

function button(label: string) {
  return Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(label));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.getElementById('root')!);
  batch.start.mockReset();
  batch.cancel.mockReset();
  batch.current = { start: batch.start, cancel: batch.cancel, status: 'idle', result: null, error: '' };
  createUrl.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('simple cached image compression controls', () => {
  it('lists only static PNG/JPEG and never renders image previews or Blob URLs', () => {
    render();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('#1 · PNG · 120 B');
    expect(document.body.textContent).toContain('#2 · JPEG · 120 B');
    expect(document.body.textContent).not.toContain('#3');
    expect(document.body.textContent).not.toContain('#4');
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(button('Preview high quality')).toBeUndefined();
    expect(button('Check savings')).toBeUndefined();
  });

  it('selects eligible images, confirms the destructive action, and sends only selected owner IDs', () => {
    render();
    act(() => button('Select all')!.click());
    expect(document.body.textContent).toContain('Selected: 2');
    act(() => button('Compress selected')!.click());
    expect(document.body.textContent).toContain('Back up first');
    expect(batch.start).not.toHaveBeenCalled();
    act(() => button('Confirm compression')!.click());
    expect(batch.start).toHaveBeenCalledOnce();
    expect(batch.start).toHaveBeenCalledWith([
      { id: 1, conversationId: 1 },
      { id: 2, conversationId: 1 },
    ]);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('keeps cancellation and actually saved bytes visible when the resource scan becomes stale', () => {
    batch.current = {
      ...batch.current,
      status: 'running',
      result: {
        processed: 1,
        total: 2,
        bytesSaved: 30,
        savedCount: 1,
        noSavingsCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        entries: [{ id: 1, conversationId: 1, status: 'saved', bytesSaved: 30 }],
      },
    };
    render(false);
    const cancel = button('Stop after current image')!;
    expect(cancel.disabled).toBe(false);
    expect(document.body.textContent).toContain('Space saved');
    expect(document.body.textContent).toContain('30 B');
    act(() => cancel.click());
    expect(batch.cancel).toHaveBeenCalledOnce();
  });

  it('disables destructive actions while the audit is stale', () => {
    render(false);
    expect(Array.from(document.querySelectorAll('button')).every((item) => item.disabled)).toBe(true);
    expect(Array.from(document.querySelectorAll('input')).every((item) => item.disabled)).toBe(true);
  });
});
