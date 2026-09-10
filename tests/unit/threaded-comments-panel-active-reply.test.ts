import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
vi.mock('../../src/ui/i18n', () => ({ t: (key: string) => key }));
import { mountThreadedCommentsPanel } from '@ui/comments';
import { getCommentSidebarPanelTestDriver } from '../helpers/comment-sidebar-panel-driver';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};
}
function cleanupDom() {
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'getComputedStyle'])
    delete (globalThis as any)[key];
}
async function flush() {
  await Promise.resolve();
  await new Promise<void>((r) => setImmediate(r));
  await Promise.resolve();
}

describe('single active reply composer', () => {
  beforeEach(setupDom);
  afterEach(async () => {
    await flush();
    cleanupDom();
  });
  it('does not auto-open a reply composer for a single root', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'one' },
    ]);
    await flush();
    const shadow = host.querySelector('webclipper-threaded-comments-panel')!.shadowRoot!;
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeNull();
    mounted.cleanup();
  });

  it('dismisses the active reply composer outside its thread and preserves the draft', async () => {
    const host = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(host, outside);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'one' },
    ]);
    await flush();
    const shadow = host.querySelector('webclipper-threaded-comments-panel')!.shadowRoot!;
    const comment = shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement;
    comment.click();
    await flush();
    let textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    textarea.value = 'kept draft';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    outside.dispatchEvent(new window.Event('pointerdown', { bubbles: true, composed: true }));
    await flush();
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeNull();

    comment.click();
    await flush();
    textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('kept draft');
    mounted.cleanup();
  });

  it('dismisses the active reply composer when keyboard focus moves outside its thread', async () => {
    const host = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(host, outside);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'one' },
    ]);
    await flush();
    const shadow = host.querySelector('webclipper-threaded-comments-panel')!.shadowRoot!;
    (shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement).click();
    await flush();
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeTruthy();

    outside.focus();
    await flush();
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeNull();
    mounted.cleanup();
  });

  it('mounts only for the active root and preserves drafts across switches', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    getCommentSidebarPanelTestDriver(mounted.api).replaceComments([
      { id: 1, parentId: null, createdAt: 1000, commentText: 'one' },
      { id: 2, parentId: null, createdAt: 2000, commentText: 'two' },
    ]);
    await flush();
    const shadow = host.querySelector('webclipper-threaded-comments-panel')!.shadowRoot!;
    expect(shadow.querySelectorAll('.webclipper-inpage-comments-panel__reply-textarea')).toHaveLength(0);
    const threads = shadow.querySelectorAll('.webclipper-inpage-comments-panel__comment');
    (threads[0] as HTMLElement).click();
    await flush();
    let textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    textarea.value = 'draft-two';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    (threads[1] as HTMLElement).click();
    await flush();
    textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    textarea.value = 'draft-one';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    (threads[0] as HTMLElement).click();
    await flush();
    textarea = shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('draft-two');
    expect(shadow.querySelectorAll('.webclipper-inpage-comments-panel__reply-textarea')).toHaveLength(1);
    mounted.cleanup();
  });

  it('clears the active reply composer when its root disappears', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountThreadedCommentsPanel(host, { overlay: false, showHeader: false });
    const driver = getCommentSidebarPanelTestDriver(mounted.api);
    driver.replaceComments([{ id: 1, parentId: null, createdAt: 1000, commentText: 'one' }]);
    await flush();
    const shadow = host.querySelector('webclipper-threaded-comments-panel')!.shadowRoot!;
    (shadow.querySelector('.webclipper-inpage-comments-panel__comment') as HTMLElement).click();
    await flush();
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeTruthy();

    driver.replaceComments([]);
    await flush();
    expect(shadow.querySelector('.webclipper-inpage-comments-panel__reply-textarea')).toBeNull();
    mounted.cleanup();
  });
});
