import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const fixture = vi.hoisted(() => ({
  model: null as any,
  refresh: vi.fn(),
  optimize: vi.fn(async () => {}),
  cancel: vi.fn(),
}));
vi.mock('@viewmodels/conversations/useConversationStorage', () => ({
  useConversationStorage: () => fixture.model,
}));
vi.mock('@i18n', () => ({
  t: (key: string) =>
    ({
      detailStorageLocalImages: '本地图片',
      detailStorageShow: '查看',
      detailStorageHide: '收起',
      detailStorageMore: '显示更多',
      detailStorageOptimize: '优化图片',
      detailStorageConfirmHint: '仅优化本条内容的 PNG 图片',
      detailStorageConfirm: '确认优化',
      detailStorageOptimizing: '正在优化',
      detailStorageStop: '停止',
      detailStorageFinished: '完成',
      detailStorageSaved: '已优化',
      detailStorageFreed: '节省',
      detailStorageLoadFailed: '本地图片读取失败',
      detailStorageRetry: '重试',
      cancelButton: '取消',
    })[key as 'detailStorageLocalImages'] || key,
}));

import { DetailStorageSection } from '@ui/conversations/DetailStorageSection';

const details = {
  imageBytes: 2_420_000,
  images: [
    { id: 12, label: '文章插图.png', bytes: 1_600_000, format: 'PNG', optimizable: true },
    { id: 13, label: '文章封面.jpg', bytes: 820_000, format: 'JPEG', optimizable: false },
  ],
};
const messages = [{ id: 1, conversationId: 11, messageKey: 'body', role: 'article', contentMarkdown: '正文' }];
function setModel(next: Record<string, unknown>) {
  fixture.model = {
    status: 'ready',
    details,
    error: '',
    refresh: fixture.refresh,
    optimize: fixture.optimize,
    cancel: fixture.cancel,
    optimization: { status: 'idle', progress: null, error: '' },
    ...next,
  };
}

describe('DetailView compact image storage', () => {
  let root: ReactDOM.Root;
  beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'https://example.com',
      pretendToBeVisual: true,
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    fixture.refresh.mockReset();
    fixture.optimize.mockReset();
    fixture.cancel.mockReset();
    setModel({});
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  async function open() {
    const trigger = document.querySelector('[data-detail-storage] button[aria-controls]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    return document.querySelector('#detail-storage-breakdown')!;
  }

  it('shows one image-size row and only downloaded images, with explicit confirmation before optimization', async () => {
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.body.textContent).toContain('本地图片 2.4 MB');
    expect(document.body.textContent).toContain('查看');
    expect(document.querySelector('#detail-storage-breakdown')).toBeNull();
    const expanded = await open();
    expect(expanded.textContent).toContain('文章插图.png');
    expect(expanded.textContent).toContain('PNG · 1.6 MB');
    expect(expanded.textContent).toContain('文章封面.jpg');
    expect(expanded.textContent).toContain('JPEG · 820 KB');
    expect(expanded.textContent).not.toContain('远程');
    expect(expanded.textContent).not.toContain('引用失效');
    expect(expanded.textContent).not.toContain('正文');
    expect(expanded.textContent).not.toContain('28 KB');

    const optimizeButton = [...expanded.querySelectorAll('button')].find((b) => b.textContent?.includes('优化图片'))!;
    expect(optimizeButton.textContent).toContain('优化图片 (1)');
    await act(async () => optimizeButton.click());
    expect(expanded.textContent).toContain('仅优化本条内容的 PNG 图片');
    expect(fixture.optimize).not.toHaveBeenCalled();
    const confirm = [...expanded.querySelectorAll('button')].find((b) => b.textContent?.includes('确认优化'))!;
    await act(async () => confirm.click());
    expect(fixture.optimize).toHaveBeenCalledOnce();
  });

  it('renders nothing for text-only, remote-only or missing-image items, including while loading', async () => {
    setModel({ details: { imageBytes: 0, images: [] } });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.querySelector('[data-detail-storage]')).toBeNull();
    expect(document.body.textContent).toBe('');

    setModel({ status: 'loading', details: null });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.querySelector('[data-detail-storage]')).toBeNull();
  });

  it('does not offer optimization for an existing local JPEG or GIF without eligible PNGs', async () => {
    setModel({ details: { imageBytes: 820_000, images: [details.images[1]] } });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    const expanded = await open();
    expect(expanded.textContent).toContain('文章封面.jpg');
    expect(expanded.textContent).not.toContain('优化图片');
    expect(expanded.querySelector('button')).toBeNull();
  });

  it('shows a small retry action when a real local image cannot be inspected', async () => {
    setModel({ details: null, status: 'error', error: 'IndexedDB unavailable' });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.body.textContent).not.toContain('B ·');
    expect(document.body.textContent).toContain('本地图片读取失败');
    const retry = document.querySelector('[data-detail-storage] button') as HTMLButtonElement;
    await act(async () => retry.click());
    expect(fixture.refresh).toHaveBeenCalledOnce();
  });

  it('supports cancellation and reports actual savings without adding duplicate totals', async () => {
    setModel({
      optimization: {
        status: 'running',
        progress: { processed: 1, total: 3, optimized: 1, bytesSaved: 120_000, cancelled: false },
        error: '',
      },
    });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    let expanded = await open();
    expect(expanded.textContent).toContain('正在优化 1/3');
    const stop = [...expanded.querySelectorAll('button')].find((b) => b.textContent?.includes('停止'))!;
    await act(async () => stop.click());
    expect(fixture.cancel).toHaveBeenCalledOnce();

    setModel({
      optimization: {
        status: 'done',
        progress: { processed: 3, total: 3, optimized: 1, bytesSaved: 120_000, cancelled: false },
        error: '',
      },
    });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expanded = document.querySelector('#detail-storage-breakdown')!;
    expect(expanded.textContent).toContain('120 KB');
    expect(expanded.textContent).toContain('已优化 1');
    expect(document.body.textContent).not.toContain('本条内容占用');
  });
});
