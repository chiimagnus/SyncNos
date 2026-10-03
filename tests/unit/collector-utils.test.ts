import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { inEditMode } from '../../src/collectors/collector-utils';

const originalDocument = globalThis.document;

afterEach(() => {
  if (originalDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = originalDocument;
});

describe('collector-utils', () => {
  it('uses the root ownerDocument when detecting focused edit controls', () => {
    const outer = new JSDOM('<body><textarea id="outer"></textarea></body>');
    const inner = new JSDOM('<body><main id="root"><textarea id="inner"></textarea></main></body>', {
      pretendToBeVisual: true,
    });
    (globalThis as any).document = outer.window.document;

    const root = inner.window.document.getElementById('root');
    const textarea = inner.window.document.getElementById('inner') as HTMLTextAreaElement;
    textarea.focus();

    expect(outer.window.document.activeElement).not.toBe(textarea);
    expect(inner.window.document.activeElement).toBe(textarea);
    expect(inEditMode(root)).toBe(true);
  });
});
