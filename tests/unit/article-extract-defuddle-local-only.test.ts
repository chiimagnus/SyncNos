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
});
