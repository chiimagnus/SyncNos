import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

import type { CommentSidebarItem } from '@services/comments/sidebar/comment-sidebar-contract';
import { MarkdownContent } from '@ui/shared/MarkdownContent';
import { ChatMessageBubble } from '@ui/shared/ChatMessageBubble';

const commentMarkdownProps = {
  renderImages: false,
  className: 'webclipper-inpage-comments-panel__markdown',
};
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
    vi.restoreAllMocks();
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

    const host = await renderIntoHost(createElement(MarkdownContent, { ...commentMarkdownProps, markdown }));
    expect(document.querySelector('style[data-syncnos-katex]')).toBeNull();
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

  it('shares punctuation-adjacent emphasis rules with article and chat rendering', async () => {
    const host = await renderIntoHost(
      createElement(MarkdownContent, { ...commentMarkdownProps, markdown: '**采集完成。**继续阅读 *重点。*正文' }),
    );
    expect(host.querySelector('strong')?.textContent).toBe('采集完成。');
    expect(host.querySelector('em')?.textContent).toBe('重点。');
    expect(host.textContent?.trim()).toBe('采集完成。继续阅读 重点。正文');
  });

  it('does not reparse unchanged comment Markdown on unrelated rerenders', async () => {
    const renderSpy = vi.spyOn(MarkdownIt.prototype, 'render');
    await renderIntoHost(createElement(MarkdownContent, { ...commentMarkdownProps, markdown: '**same**' }));
    expect(renderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root!.render(createElement(MarkdownContent, { ...commentMarkdownProps, markdown: '**same**' }));
      await Promise.resolve();
    });
    expect(renderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root!.render(createElement(MarkdownContent, { ...commentMarkdownProps, markdown: '**changed**' }));
      await Promise.resolve();
    });
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('uses identical Markdown and math HTML across article, chat and comments with one stylesheet lifetime', async () => {
    const markdown =
      '**共同规则。**正文\n\n|a|b|\n|-|-|\n|1|2|\n\n$E=mc^2$\n\n$$\\frac{1}{x}$$\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))';
    const host = await renderIntoHost(
      createElement(
        StrictMode,
        null,
        createElement(
          'div',
          null,
          createElement(ChatMessageBubble, { markdown, className: 'article-markdown' }),
          createElement(ChatMessageBubble, { markdown, role: 'assistant', className: 'chat-markdown' }),
          createElement(MarkdownContent, { ...commentMarkdownProps, markdown }),
        ),
      ),
    );
    await act(async () => {
      await import('@ui/shared/markdown-math-styles');
    });
    const article = host.querySelector('.article-markdown')!;
    const chat = host.querySelector('.chat-markdown')!;
    const comment = host.querySelector('.webclipper-inpage-comments-panel__markdown')!;
    expect(article.querySelectorAll('.katex-html')).toHaveLength(2);
    expect(article.querySelector('.katex-error')).toBeNull();
    expect(article.querySelector('script, a[href^="javascript:"]')).toBeNull();
    expect(article.querySelector('.katex-display annotation')?.textContent).toBe(String.raw`\frac{1}{x}`);
    expect(article.innerHTML).toBe(chat.innerHTML);
    expect(article.innerHTML).toBe(comment.innerHTML);
    expect(document.querySelectorAll('[data-syncnos-katex="fonts"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-syncnos-katex="layout"]')).toHaveLength(1);

    await act(async () => root!.render(createElement(MarkdownContent, { ...commentMarkdownProps, markdown })));
    expect(host.querySelectorAll('.katex-html')).toHaveLength(2);
    expect(document.querySelectorAll('[data-syncnos-katex="fonts"]')).toHaveLength(1);
    await act(async () =>
      root!.render(createElement(MarkdownContent, { ...commentMarkdownProps, markdown: 'No math' })),
    );
    expect(document.querySelector('[data-syncnos-katex]')).toBeNull();
  });

  it('preserves image policy and resolved sources when math and images share the common renderer', async () => {
    const markdown = '$x$\n\n![cached](syncnos-asset://7)\n\n![remote](https://example.com/a.png)';
    const host = await renderIntoHost(
      createElement(
        'div',
        null,
        createElement(ChatMessageBubble, {
          markdown,
          className: 'article-markdown',
          syncnosAssetSrcById: new Map([[7, 'blob:cached-7']]),
        }),
        createElement(MarkdownContent, { ...commentMarkdownProps, markdown }),
      ),
    );
    await act(async () => {
      await import('@ui/shared/markdown-math-styles');
    });
    expect(host.querySelector('.article-markdown img')?.getAttribute('src')).toBe('blob:cached-7');
    expect(host.querySelector('.webclipper-inpage-comments-panel__markdown img')).toBeNull();
    expect(host.querySelector('.webclipper-inpage-comments-panel__markdown a')?.getAttribute('href')).toBe(
      'https://example.com/a.png',
    );
    expect(host.querySelectorAll('.katex-html')).toHaveLength(2);
  });

  it('renders inline and block math with KaTeX HTML after the lazy runtime loads', async () => {
    const host = await renderIntoHost(
      createElement(MarkdownContent, { ...commentMarkdownProps, markdown: '$E=mc^2$\n\n$$x^2$$' }),
    );
    await act(async () => {
      await import('@ui/shared/markdown-math-styles');
      await Promise.resolve();
    });
    expect(host.querySelectorAll('.katex-html')).toHaveLength(2);
    expect(host.querySelector('.katex-display .katex-html')).toBeTruthy();
    expect(host.querySelectorAll('.katex-mathml math')).toHaveLength(2);
    expect(document.querySelector('style[data-syncnos-katex="fonts"]')).toBeTruthy();
    expect(document.querySelector('style[data-syncnos-katex="layout"]')?.textContent).toContain('.katex .katex-mathml');
  });

  it('keeps advanced formulas in the HTML layout tree and removes styles when math is removed', async () => {
    const host = await renderIntoHost(
      createElement(MarkdownContent, {
        ...commentMarkdownProps,
        markdown: String.raw`$$\boxed{E=mc^2}+\cancel{x}+\mathcal{A}+\mathfrak{B}+\mathscr{C}+\underset{a}{\overset{b}{X}}$$`,
      }),
    );
    await act(async () => {
      await import('@ui/shared/markdown-math-styles');
      await Promise.resolve();
    });
    const visual = host.querySelector('.katex-html')!;
    expect(visual).toBeTruthy();
    expect(visual.querySelector('.fbox')).toBeTruthy();
    expect(visual.querySelector('svg line')).toBeTruthy();
    expect(visual.querySelector('.mathcal')).toBeTruthy();
    expect(visual.querySelector('.mathfrak')).toBeTruthy();
    expect(visual.querySelector('.mathscr')).toBeTruthy();
    expect(visual.querySelector('.vlist')).toBeTruthy();
    await act(async () =>
      root!.render(createElement(MarkdownContent, { ...commentMarkdownProps, markdown: 'No formula' })),
    );
    expect(host.querySelector('.katex')).toBeNull();
    expect(document.querySelector('style[data-syncnos-katex]')).toBeNull();
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
    expect(css).not.toMatch(/__markdown\s+eqn?\s*\{/);
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
