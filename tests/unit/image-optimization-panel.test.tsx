// @vitest-environment jsdom
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  current: {} as any,
  prepare: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@viewmodels/settings/useStorageImageOptimization', () => ({
  useStorageImageOptimization: () => state.current,
}));
const batch = vi.hoisted(() => ({ current: {} as any, start: vi.fn(), cancel: vi.fn() }));
vi.mock('@viewmodels/settings/useStorageImageBatch', () => ({
  useStorageImageBatch: () => batch.current,
}));
import { ImageOptimizationPanel } from '@ui/settings/sections/ImageOptimizationPanel';

let root: ReactDOM.Root;
const createUrl = vi.fn();
const revokeUrl = vi.fn();
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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  root = ReactDOM.createRoot(document.getElementById('root')!);
  state.current = {
    preview: null,
    previewStatus: 'idle',
    previewError: '',
    preparePreview: state.prepare,
    cancelPreview: state.cancel,
    savePreview: state.save,
    saveStatus: 'idle',
    saveError: '',
    savedBytes: 0,
  };
  state.prepare.mockReset();
  state.cancel.mockReset();
  state.save.mockReset();
  batch.start.mockReset();
  batch.cancel.mockReset();
  batch.current = { start: batch.start, cancel: batch.cancel, status: 'idle', result: null, error: '' };
  createUrl.mockReset().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:new');
  revokeUrl.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('image preview UI', () => {
  it('offers only eligible static PNG/JPEG, with explicit lossy preview limited to JPEG', () => {
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: true })));
    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons.filter((button) => button.textContent?.includes('Preview exact pixels'))).toHaveLength(2);
    expect(buttons.filter((button) => button.textContent?.includes('Preview high quality'))).toHaveLength(1);
    const lossy = buttons.find((button) => button.textContent?.includes('Preview high quality'))!;
    act(() => lossy.click());
    expect(state.prepare).toHaveBeenCalledWith({ id: 2, conversationId: 1 }, 'lossy-preview');
    expect(document.body.textContent).not.toContain('#3');
    expect(document.body.textContent).not.toContain('#4');
  });

  it('shows two inspectable image previews and frees URLs on dismissal', () => {
    state.current = {
      ...state.current,
      previewStatus: 'ready',
      preview: {
        selection: { id: 1, conversationId: 1 },
        result: {
          mode: 'pixel-exact',
          originalBlob: new Blob(['original']),
          optimizedBlob: new Blob(['optimized']),
          originalBytes: 200,
          optimizedBytes: 80,
          savedBytes: 120,
          width: 80,
          height: 60,
        },
      },
    };
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: true })));
    const images = Array.from(document.querySelectorAll('img'));
    expect(images).toHaveLength(2);
    expect(images.map((image) => image.getAttribute('src'))).toEqual(['blob:old', 'blob:new']);
    expect(document.body.textContent).toContain('120 B');
    expect(document.body.textContent).toContain('80×60');
    const save = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save optimized image',
    )!;
    act(() => save.click());
    expect(state.save).toHaveBeenCalledWith(false);
    const close = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Close preview',
    )!;
    act(() => close.click());
    expect(state.cancel).toHaveBeenCalledOnce();

    act(() => root.unmount());
    root = ReactDOM.createRoot(document.createElement('div'));
    expect(revokeUrl).toHaveBeenCalledWith('blob:old');
    expect(revokeUrl).toHaveBeenCalledWith('blob:new');
  });

  it('requires a second explicit acknowledgment before a lossy image can be saved', () => {
    state.current = {
      ...state.current,
      previewStatus: 'ready',
      preview: {
        selection: { id: 2, conversationId: 1 },
        result: {
          mode: 'lossy-preview',
          originalBlob: new Blob(['original']),
          optimizedBlob: new Blob(['optimized']),
          originalBytes: 200,
          optimizedBytes: 50,
          savedBytes: 150,
          width: 80,
          height: 60,
        },
      },
    };
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: true })));
    const save = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save optimized image',
    )!;
    expect(save.disabled).toBe(true);
    const acceptance = Array.from(document.querySelectorAll('input[type="checkbox"]')).at(-1)!;
    expect(acceptance).toBeTruthy();
    act(() => acceptance.click());
    expect(save.disabled).toBe(false);
    act(() => save.click());
    expect(state.save).toHaveBeenCalledWith(true);
  });

  it('selects eligible images, requires batch confirmation and submits only selected owner IDs', () => {
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: true })));
    const selectAll = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Select eligible'),
    )!;
    act(() => selectAll.click());
    expect(document.body.textContent).toContain('Selected: 2');
    const review = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Review batch'),
    )!;
    act(() => review.click());
    expect(document.body.textContent).toContain('one by one');
    const confirm = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Confirm batch optimization'),
    )!;
    act(() => confirm.click());
    expect(batch.start).toHaveBeenCalledOnce();
    expect(batch.start).toHaveBeenCalledWith([
      { id: 1, conversationId: 1 },
      { id: 2, conversationId: 1 },
    ]);
    expect(state.cancel).toHaveBeenCalledOnce();
  });

  it('keeps cancellation and committed savings visible when the audit becomes stale', () => {
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
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: false })));
    const cancel = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Stop after current image'),
    )!;
    expect(cancel.disabled).toBe(false);
    expect(document.body.textContent).toContain('Verified bytes saved');
    expect(document.body.textContent).toContain('30 B');
    act(() => cancel.click());
    expect(batch.cancel).toHaveBeenCalledOnce();
  });

  it('disables actions when the audit is stale or a candidate is still processing', () => {
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: false })));
    expect(Array.from(document.querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
    state.current = { ...state.current, previewStatus: 'loading' };
    act(() => root.render(createElement(ImageOptimizationPanel, { assets, scanValid: true })));
    expect(
      Array.from(document.querySelectorAll('button'))
        .filter((button) => button.textContent?.includes('Preview'))
        .every((button) => button.disabled),
    ).toBe(true);
  });
});
