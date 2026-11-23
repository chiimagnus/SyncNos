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
      detailStorageTotal: '本条内容占用',
      detailStorageShow: '查看明细',
      detailStorageHide: '收起',
      detailStorageHeading: '当前内容的本地存储',
      detailStorageText: '正文',
      detailStorageImages: '图片',
      detailStorageResources: '该内容的图片资源',
      detailStorageNoImages: '该内容没有本地图片资源',
      detailStorageMissing: '引用失效',
      detailStorageRemoteRefs: '其他／远程引用',
      detailStorageBrokenRefs: '失效的本地资源引用',
      detailStorageEstimateHint: '按正文 UTF-8 字节与可读的本地图片计算',
      detailStorageOptimize: '优化本条图片',
      detailStorageCandidates: '张可尝试',
      detailStorageNoneOptimizable: '没有可优化的图片',
      detailStorageConfirmHint: '仅尝试当前内容的静态 PNG',
      detailStorageConfirm: '确认优化',
      detailStorageOptimizing: '正在优化',
      detailStorageFinished: '优化完成',
      detailStorageSaved: '成功优化',
      detailStorageChecked: '已检查',
      detailStorageFreed: '节省',
      detailStorageLoadFailed: '存储信息读取失败',
      detailStorageLoading: '计算中',
      detailStorageRetry: '重试',
      cancelButton: '取消',
    })[key as 'detailStorageTotal'] || key,
}));

import { DetailStorageSection } from '@ui/conversations/DetailStorageSection';

const details = {
  textBytes: 28_000,
  imageBytes: 2_420_000,
  totalBytes: 2_448_000,
  localReferences: 5,
  otherReferences: 1,
  missingReferences: 1,
  images: [
    { id: 12, label: '文章插图.png', bytes: 1_600_000, format: 'PNG', state: 'ready', optimizable: true },
    { id: 13, label: '文章封面.jpg', bytes: 820_000, format: 'JPEG', state: 'ready', optimizable: false },
    { id: 14, label: '丢失的图片', bytes: 0, format: '', state: 'missing', optimizable: false },
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

describe('DetailView inline storage disclosure', () => {
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
    await act(async () => {
      trigger.click();
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    return document.querySelector('#detail-storage-breakdown')!;
  }

  it('keeps the existing menu compact, expands the current item and explicitly confirms PNG optimization', async () => {
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.body.innerText || document.body.textContent).toContain('2.4 MB');
    expect(document.querySelector('#detail-storage-breakdown')).toBeNull();
    const expanded = await open();
    expect(expanded.textContent).toContain('正文');
    expect(expanded.textContent).toContain('28 KB');
    expect(expanded.textContent).toContain('图片');
    expect(expanded.textContent).toContain('2.4 MB');
    expect(expanded.textContent).toContain('文章插图.png');
    expect(expanded.textContent).toContain('PNG · 1.6 MB');
    expect(expanded.textContent).toContain('文章封面.jpg');
    expect(expanded.textContent).toContain('JPEG · 820 KB');
    expect(expanded.textContent).toContain('丢失的图片');
    expect(expanded.textContent).toContain('引用失效');
    expect(expanded.textContent).toContain('其他／远程引用 1');

    const optimizeButton = [...expanded.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('优化本条图片'),
    )!;
    expect(optimizeButton.textContent).toContain('1 张可尝试');
    await act(async () => optimizeButton.click());
    expect(expanded.textContent).toContain('仅尝试当前内容的静态 PNG');
    expect(fixture.optimize).not.toHaveBeenCalled();
    const confirm = [...expanded.querySelectorAll('button')].find((b) => b.textContent?.includes('确认优化'))!;
    await act(async () => confirm.click());
    expect(fixture.optimize).toHaveBeenCalledOnce();
  });

  it('does not display a useless optimization control for pure text or video subtitles', async () => {
    setModel({
      details: { ...details, images: [], imageBytes: 0, totalBytes: 44_000, localReferences: 0, otherReferences: 0 },
    });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    const expanded = await open();
    expect(expanded.textContent).toContain('该内容没有本地图片资源');
    expect(expanded.querySelector('button')).toBeNull();
  });

  it('offers retry when inspection fails without claiming a fabricated size', async () => {
    setModel({ details: null, status: 'error', error: 'IndexedDB unavailable' });
    await act(async () => root.render(createElement(DetailStorageSection, { conversationId: 11, messages })));
    expect(document.body.textContent).toContain('—');
    const expanded = await open();
    const button = expanded.querySelector('button')!;
    expect(button.textContent).toContain('重试');
    await act(async () => button.click());
    expect(fixture.refresh).toHaveBeenCalledOnce();
  });

  it('supports cancellation and a truthful completed result', async () => {
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
    const stop = [...expanded.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Stop') || b.textContent?.includes('detailStorageStop'),
    )!;
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
    expect(expanded.textContent).toContain('成功优化 1');
  });
});
