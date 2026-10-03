import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compactConversationTitle,
  firstUserMessageTitle,
  inEditMode,
  renderedElementText,
} from '../../src/collectors/collector-utils';

const originalDocument = globalThis.document;

afterEach(() => {
  if (originalDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = originalDocument;
});

describe('collector-utils', () => {
  it('detects the focused edit textarea even when another textarea comes first', () => {
    const dom = new JSDOM(
      '<main><textarea id="first"></textarea><textarea id="editing"></textarea></main><textarea id="outside"></textarea>',
    );
    const root = dom.window.document.querySelector('main');
    (dom.window.document.getElementById('editing') as HTMLTextAreaElement).focus();
    expect(inEditMode(root)).toBe(true);
    (dom.window.document.getElementById('outside') as HTMLTextAreaElement).focus();
    expect(inEditMode(root)).toBe(false);
  });

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

  it('prefers rendered innerText over duplicated hidden textContent for page titles', () => {
    const dom = new JSDOM('<body><a id="title"><span>Visible</span><span hidden>Hidden duplicate</span></a></body>');
    const title = dom.window.document.getElementById('title') as HTMLElement;
    Object.defineProperty(title, 'innerText', { configurable: true, value: 'Visible' });

    expect(title.textContent).toContain('Hidden duplicate');
    expect(renderedElementText(title)).toBe('Visible');
  });

  it('builds a compact fallback title from first-user semantic text', () => {
    expect(firstUserMessageTitle([{ role: 'user', contentMarkdown: 'Hello **world**' }])).toBe('Hello world');
    expect(compactConversationTitle('a'.repeat(80), 12)).toBe(`${'a'.repeat(11)}…`);
  });
});
