import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function popupCss(): string {
  return readFileSync(new URL('../../src/entrypoints/popup/style.css', import.meta.url), 'utf8');
}

describe('popup viewport layout contract', () => {
  it('keeps host autosizing separate from the viewport-bound app root', () => {
    const css = popupCss();

    expect(css).toContain('width: 420px;');
    expect(css).toContain('min-height: 600px;');
    expect(css).toContain('#root {');
    expect(css).toContain('position: fixed;');
    expect(css).toContain('inset: 0;');
    expect(css).toContain('width: min(420px, 100vw);');
    expect(css).toContain('height: min(600px, 100vh);');
  });
});
