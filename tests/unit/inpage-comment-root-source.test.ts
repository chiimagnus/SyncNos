import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';

import { captureCommentAnchor } from '../../src/services/comments/locator/capture-comment-anchor';
import { createInpageCommentRootSource } from '../../src/ui/comments/inpage-comment-root-source';

describe('inpage comment root source', () => {
  test('derives the smallest stable capture root from the current selection', () => {
    const document = new JSDOM('<main><article><p>Hello <b>world</b></p></article></main>', {
      url: 'https://example.com/',
    }).window.document;
    const text = document.querySelector('b')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    const roots = createInpageCommentRootSource({ document }).capture(selection);
    expect(roots?.sourceRoot).toBe(document.querySelector('b'));
  });

  test('tightens browser block-selection boundaries before choosing the locator root', () => {
    const document = new JSDOM('<body><p id="p1">A<br>B</p><p id="p2">C</p></body>', {
      url: 'https://example.com/',
    }).window.document;
    const p1 = document.getElementById('p1')!;
    const p2 = document.getElementById('p2')!;
    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p2, 0);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    const source = createInpageCommentRootSource({ document });

    expect(source.capture(selection)?.sourceRoot).toBe(p1);
    expect(source.captureAnchor(selection)).toMatchObject({
      v: 2,
      surfaceHint: 'inpage',
      quote: { exact: 'A\nB' },
    });
  });

  test('does not truncate a genuine selection spanning multiple body-level blocks', () => {
    const document = new JSDOM('<body><p id="p1">First</p><p id="p2">Second</p></body>', {
      url: 'https://example.com/',
    }).window.document;
    const p1 = document.getElementById('p1')!;
    const p2 = document.getElementById('p2')!;
    const range = document.createRange();
    range.setStart(p1.firstChild!, 0);
    range.setEnd(p2.firstChild!, 6);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    const source = createInpageCommentRootSource({ document });

    expect(source.capture(selection)).toBeNull();
    expect(source.captureAnchor(selection)).toBeNull();
  });

  test('rejects panel selections and body-only capture fallback', () => {
    const document = new JSDOM('<body><div id="panel">panel</div><span>page</span></body>', {
      url: 'https://example.com/',
    }).window.document;
    const panel = document.querySelector('#panel')!;
    const range = document.createRange();
    range.selectNodeContents(panel);
    const selection = { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
    const source = createInpageCommentRootSource({ document, getPanelRoot: () => panel });
    expect(source.capture(selection)).toBeNull();
  });

  test('restores document-relative root first and limits evidence candidates', () => {
    const document = new JSDOM('<main><article>exact</article><article>other</article></main>', {
      url: 'https://example.com/',
    }).window.document;
    const root = document.querySelector('article')!;
    const range = document.createRange();
    range.selectNodeContents(root.firstChild!);
    const locator = captureCommentAnchor({
      root,
      range,
      surfaceHint: 'inpage',
      documentRoot: document.documentElement,
    })!;
    const candidates = createInpageCommentRootSource({ document, maxCandidates: 1 }).locate(locator);
    expect(candidates).toEqual([root]);
  });

  test('bounds evidence checks even when later candidates would match', () => {
    const document = new JSDOM(
      `<main>${Array.from({ length: 12 }, (_, index) => `<article data-testid="candidate-${index}">text-${index}</article>`).join('')}</main>`,
      { url: 'https://example.com/' },
    ).window.document;
    const root = document.querySelector('[data-testid="candidate-11"]')!;
    const range = document.createRange();
    range.selectNodeContents(root.firstChild!);
    const locator = captureCommentAnchor({ root, range, surfaceHint: 'inpage' })!;

    expect(createInpageCommentRootSource({ document, maxCandidates: 4 }).locate(locator)).toEqual([]);
  });
});
