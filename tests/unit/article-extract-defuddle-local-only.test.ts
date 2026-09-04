import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const parse = vi.fn(() => ({
    title: 'Local article',
    author: '',
    published: '',
    description: '',
    content: '<p>Captured locally</p>',
  }));
  const parseAsync = vi.fn();
  const Defuddle = vi.fn(function Defuddle() {
    return { parse, parseAsync };
  });
  return { parse, parseAsync, Defuddle };
});

vi.mock('defuddle', () => ({ default: mocks.Defuddle }));

import { extractByDefuddle } from '../../src/collectors/web/article-extract/defuddle';

afterEach(() => {
  mocks.parse.mockClear();
  mocks.parseAsync.mockClear();
  mocks.Defuddle.mockClear();
  vi.unstubAllGlobals();
});

describe('article-extract Defuddle local-only policy', () => {
  it('uses synchronous local parsing and never starts the async network fallback', () => {
    vi.stubGlobal('document', {
      cloneNode: vi.fn(() => ({})),
      createElement: vi.fn(() => {
        let innerText = '';
        return {
          set innerHTML(value: string) {
            innerText = String(value).replace(/<[^>]*>/g, '');
          },
          get innerText() {
            return innerText;
          },
          get textContent() {
            return innerText;
          },
        };
      }),
      title: 'Fallback title',
    });

    expect(extractByDefuddle('https://example.com/article')).toMatchObject({
      title: 'Local article',
      textContent: 'Captured locally',
    });
    expect(mocks.Defuddle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ useAsync: false }));
    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(mocks.parseAsync).not.toHaveBeenCalled();
  });

  it('prefers a semantic page h1 that Defuddle preserved as the leading article heading', () => {
    const dom = new JSDOM(
      '<!doctype html><html><head><title>Site chrome title</title></head><body><h1>Actual article title</h1></body></html>',
    );
    vi.stubGlobal('document', dom.window.document);
    mocks.parse.mockReturnValueOnce({
      title: 'Author on Site',
      author: '',
      published: '',
      description: '',
      content: '<article><h2>Actual article title</h2><p>Captured locally</p></article>',
    });

    expect(extractByDefuddle('https://example.com/article')).toMatchObject({
      title: 'Actual article title',
      textContent: 'Actual article titleCaptured locally',
    });
  });

  it('keeps Defuddle title when the extracted heading is not the page h1', () => {
    const dom = new JSDOM('<!doctype html><html><body><h1>Actual article title</h1></body></html>');
    vi.stubGlobal('document', dom.window.document);
    mocks.parse.mockReturnValueOnce({
      title: 'Parser article title',
      author: '',
      published: '',
      description: '',
      content: '<article><h2>First section</h2><p>Captured locally</p></article>',
    });

    expect(extractByDefuddle('https://example.com/article')).toMatchObject({
      title: 'Parser article title',
    });
  });
});
