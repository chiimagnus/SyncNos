import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { installInpageSurfaceTheme } from '../../src/ui/inpage/inpage-surface-theme';

describe('inpage surface theme', () => {
  let dom: JSDOM;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'https://example.com/',
      pretendToBeVisual: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
  });

  it('maps the selected article surface into the in-page host tokens', () => {
    const { document } = dom.window;
    document.body.innerHTML = `
      <article id="article" style="background-color: #121418; color: #e8ebf0">
        <p id="copy">Hello</p>
      </article>
    `;
    const host = document.createElement('webclipper-threaded-comments-panel');
    document.documentElement.appendChild(host);
    const source = document.getElementById('copy')!;

    const cleanup = installInpageSurfaceTheme({
      host,
      document,
      resolveSource: () => source,
    });

    expect(host.style.getPropertyValue('--bg-card')).toBe('rgb(18, 20, 24)');
    expect(host.style.getPropertyValue('--text-primary')).toBe('rgb(232, 235, 240)');
    expect(host.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(host.style.getPropertyValue('--border')).toContain('rgb(232, 235, 240)');
    cleanup();
  });

  it('falls back to the visible article surface when there is no active source', () => {
    const { document } = dom.window;
    document.body.style.backgroundColor = 'white';
    document.body.style.color = 'black';
    document.body.innerHTML = `
      <main id="article" style="background-color: #181a1e; color: #eef0f3">
        <p id="copy">Visible article</p>
      </main>
    `;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => document.getElementById('copy'),
    });
    const host = document.createElement('webclipper-threaded-comments-panel');
    document.documentElement.appendChild(host);

    const cleanup = installInpageSurfaceTheme({ host, document });

    expect(host.style.getPropertyValue('--bg-card')).toBe('rgb(24, 26, 30)');
    expect(host.style.getPropertyValue('--text-primary')).toBe('rgb(238, 240, 243)');
    cleanup();
  });

  it('mirrors color filters below html without duplicating an html filter', () => {
    const { document } = dom.window;
    const article = document.createElement('article');
    article.style.filter = 'invert(1) hue-rotate(180deg) blur(2px)';
    article.style.backgroundColor = 'white';
    article.style.color = 'black';
    document.body.appendChild(article);

    const host = document.createElement('webclipper-threaded-comments-panel');
    document.documentElement.appendChild(host);
    const cleanup = installInpageSurfaceTheme({
      host,
      document,
      resolveSource: () => article,
    });

    expect(host.style.filter).toBe('invert(1) hue-rotate(180deg)');

    cleanup();
    document.documentElement.style.filter = 'invert(1)';
    const secondHost = document.createElement('webclipper-threaded-comments-panel');
    document.documentElement.appendChild(secondHost);
    const secondCleanup = installInpageSurfaceTheme({
      host: secondHost,
      document,
      resolveSource: () => document.body,
    });

    expect(secondHost.style.filter).toBe('');
    secondCleanup();
  });

  it('tracks dynamic page theme changes and restores host styles on cleanup', async () => {
    const { document } = dom.window;
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    document.body.style.color = 'rgb(20, 20, 20)';

    const host = document.createElement('webclipper-threaded-comments-panel');
    host.style.setProperty('--bg-card', 'papayawhip');
    document.documentElement.appendChild(host);

    const cleanup = installInpageSurfaceTheme({
      host,
      document,
      resolveSource: () => document.body,
    });
    expect(host.style.getPropertyValue('--bg-card')).toBe('rgb(255, 255, 255)');

    document.body.style.backgroundColor = 'rgb(12, 14, 18)';
    document.body.style.color = 'rgb(240, 240, 240)';
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));

    expect(host.style.getPropertyValue('--bg-card')).toBe('rgb(12, 14, 18)');
    expect(host.style.getPropertyValue('--text-primary')).toBe('rgb(240, 240, 240)');

    cleanup();
    expect(host.style.getPropertyValue('--bg-card')).toBe('papayawhip');
    expect(host.style.getPropertyValue('--text-primary')).toBe('');
  });
});
