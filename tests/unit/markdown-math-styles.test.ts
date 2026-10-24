import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';

import { mountKatexStyles } from '@ui/shared/markdown-math-styles';

function createPanel(doc: Document) {
  const host = doc.createElement('div');
  doc.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const first = doc.createElement('div');
  const second = doc.createElement('div');
  shadow.append(first, second);
  return { shadow, first, second };
}

afterEach(() => vi.unstubAllGlobals());

describe('KaTeX shadow styles', () => {
  it('shares document fonts, isolates layout in each shadow root and releases the last consumer', () => {
    const doc = new JSDOM('<!doctype html><body></body>').window.document;
    vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://syncnos/${path}` } });
    const a = createPanel(doc);
    const b = createPanel(doc);
    const releaseA1 = mountKatexStyles(a.first);
    const releaseA2 = mountKatexStyles(a.second);
    const releaseB = mountKatexStyles(b.first);
    expect(doc.querySelectorAll('style[data-syncnos-katex="fonts"]')).toHaveLength(1);
    expect(doc.querySelector('style[data-syncnos-katex="layout"]')).toBeNull();
    expect(a.shadow.querySelectorAll('style[data-syncnos-katex="layout"]')).toHaveLength(1);
    expect(b.shadow.querySelectorAll('style[data-syncnos-katex="layout"]')).toHaveLength(1);
    expect(a.shadow.querySelector('style')?.textContent).not.toContain('@font-face');
    const fontCss = doc.querySelector('style')!.textContent!;
    expect(fontCss).not.toContain('.katex');
    expect(fontCss).not.toMatch(/url\(["']?\/assets\//);
    expect(fontCss).toContain('chrome-extension://syncnos/');
    const faces: string[] = [];
    postcss.parse(fontCss).walkAtRules('font-face', (rule) => {
      faces.push(rule.toString());
    });
    expect(faces).toHaveLength(20);

    releaseA1();
    expect(a.shadow.querySelector('style')).toBeTruthy();
    releaseA2();
    expect(a.shadow.querySelector('style')).toBeNull();
    expect(doc.querySelector('style')).toBeTruthy();
    releaseB();
    expect(b.shadow.querySelector('style')).toBeNull();
    expect(doc.querySelector('style')).toBeNull();
    const releaseAgain = mountKatexStyles(a.first);
    expect(a.shadow.querySelector('style')).toBeTruthy();
    releaseAgain();
    expect(doc.querySelector('style')).toBeNull();
  });

  it('uses the owning document, not a global document, and supports light DOM consumers', () => {
    const a = new JSDOM('<!doctype html><body><div></div></body>').window.document;
    const b = new JSDOM('<!doctype html><body><div></div></body>').window.document;
    const releaseA = mountKatexStyles(a.querySelector('div')!);
    const releaseB = mountKatexStyles(b.querySelector('div')!);
    expect(a.querySelectorAll('style')).toHaveLength(2);
    expect(b.querySelectorAll('style')).toHaveLength(2);
    releaseA();
    expect(a.querySelector('style')).toBeNull();
    expect(b.querySelectorAll('style')).toHaveLength(2);
    releaseB();
    expect(b.querySelector('style')).toBeNull();
  });
});
