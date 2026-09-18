import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import { CommentMarkdown } from '@ui/comments/react/CommentMarkdown';
import { CommentQuotePreview } from '@ui/comments/react/CommentQuotePreview';
import { CommentThread } from '@ui/comments/react/CommentThread';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function comment(overrides: Partial<CommentSidebarItem>): CommentSidebarItem {
  return {
    id: 1,
    parentId: null,
    conversationId: 10,
    canonicalUrl: 'https://example.com/article',
    authorName: 'Chii',
    quoteText: '',
    commentText: '',
    locator: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('comment markdown rendering', () => {
  let root: Root | null = null;

  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  async function renderIntoHost(element: ReturnType<typeof createElement>) {
    const host = document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root!.render(element);
      await Promise.resolve();
      await Promise.resolve();
    });
    return host;
  }

  it('renders the supported markdown subset without images or raw HTML', async () => {
    const markdown = [
      '# Heading',
      '',
      '**bold** *italic* ~~strike~~ [link](https://example.com/next)',
      '',
      '> quote',
      '',
      '- one',
      '- two',
      '',
      '`inline`',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '|a|b|',
      '|-|-|',
      '|1|2|',
      '',
      '![remote](https://example.com/a.png)',
      '',
      '<script>alert(1)</script>',
    ].join('\n');

    const host = await renderIntoHost(createElement(CommentMarkdown, { markdown }));
    expect(host.querySelector('h1')?.textContent).toBe('Heading');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('em')?.textContent).toBe('italic');
    expect(host.querySelector('s')?.textContent).toBe('strike');
    expect(host.querySelector('blockquote')?.textContent).toContain('quote');
    expect(host.querySelector('ul')).toBeTruthy();
    expect(host.querySelector('pre code')?.textContent).toContain('const x = 1;');
    expect(host.querySelector('table')).toBeTruthy();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');

    const link = host.querySelector<HTMLAnchorElement>('a[href="https://example.com/next"]');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noreferrer noopener');
    const imageLink = host.querySelector<HTMLAnchorElement>('a[href="https://example.com/a.png"]');
    expect(imageLink?.textContent).toBe('remote');
  });

  it('renders inline and block math as MathML after the lazy runtime loads', async () => {
    const host = await renderIntoHost(createElement(CommentMarkdown, { markdown: '$E=mc^2$\n\n$$x^2$$' }));
    await act(async () => {
      await import('@ui/shared/markdown-math');
      await Promise.resolve();
    });
    expect(host.querySelectorAll('math').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('.katex-html')).toBeNull();
  });

  it('uses the same markdown renderer for imported roots and replies', async () => {
    const rootComment = comment({
      id: 7,
      commentText: '**Imported root**',
      importSource: 'dedao',
      importKey: 'note-1',
    });
    const reply = comment({ id: 8, parentId: 7, commentText: '|a|b|\n|-|-|\n|1|2|' });
    const host = await renderIntoHost(
      createElement(CommentThread, {
        root: rootComment,
        replies: [reply],
        active: false,
        busy: false,
        openMenuId: null,
        rootMenuActions: [],
        getReplyMenuActions: () => [],
        onActivate: () => {},
        onRootMenuToggle: () => {},
        onReplyMenuToggle: () => {},
        onMenuAction: () => {},
      }),
    );
    expect(host.querySelector('.webclipper-inpage-comments-panel__comment strong')?.textContent).toBe('Imported root');
    expect(host.querySelector('.webclipper-inpage-comments-panel__reply table')).toBeTruthy();
  });

  it('keeps markdown links interactive without activating the thread', async () => {
    const onActivate = vi.fn();
    const rootComment = comment({ id: 7, commentText: '**body** [open](https://example.com/next)' });
    const host = await renderIntoHost(
      createElement(CommentThread, {
        root: rootComment,
        replies: [],
        active: false,
        busy: false,
        openMenuId: null,
        rootMenuActions: [],
        getReplyMenuActions: () => [],
        onActivate,
        onRootMenuToggle: () => {},
        onReplyMenuToggle: () => {},
        onMenuAction: () => {},
      }),
    );

    const link = host.querySelector<HTMLAnchorElement>('a[href="https://example.com/next"]')!;
    link.addEventListener('click', (event) => event.preventDefault());
    act(() => link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onActivate).not.toHaveBeenCalled();

    const body = host.querySelector<HTMLElement>('.webclipper-inpage-comments-panel__comment strong')!;
    act(() => body.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    expect(onActivate).toHaveBeenCalledWith(7);
  });

  it('keeps markdown layout inside the shadow stylesheet without reusing quote pre-wrap rules', () => {
    const css = readFileSync(new URL('../../src/ui/styles/inpage-comments-panel.css', import.meta.url), 'utf8');
    const markdownRule = css.match(/\.webclipper-inpage-comments-panel__markdown\s*\{([\s\S]*?)\}/)?.[1];
    expect(markdownRule).toBeTruthy();
    expect(markdownRule).not.toMatch(/white-space\s*:\s*pre-wrap/);
    expect(css).toContain('.webclipper-inpage-comments-panel__markdown pre {');
    expect(css).toContain('.webclipper-inpage-comments-panel__markdown table {');
    expect(css).toContain('.webclipper-inpage-comments-panel__markdown .katex-display {');
    expect(css).toContain('.webclipper-inpage-comments-panel__markdown a:focus-visible {');
    expect(css).not.toContain(
      '.webclipper-inpage-comments-panel__comment-main > .webclipper-inpage-comments-panel__text',
    );
    expect(css).toContain('.webclipper-inpage-comments-panel__text {');
    expect(css).toMatch(/\.webclipper-inpage-comments-panel__text\s*\{[\s\S]*?white-space:\s*pre-wrap/);
  });

  it('keeps quote previews as literal source text', () => {
    const markup = renderToStaticMarkup(
      createElement(CommentQuotePreview, {
        text: '**literal** $x$',
        variant: 'thread',
        authorName: 'Chii',
        createdAt: 1,
      }),
    );
    expect(markup).toContain('**literal** $x$');
    expect(markup).not.toContain('<strong>literal</strong>');
    expect(markup).not.toContain('<math');
  });
});
