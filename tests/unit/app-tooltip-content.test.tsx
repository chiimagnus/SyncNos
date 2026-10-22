import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderAppTooltip } from '@ui/shared/AppTooltipImpl';

function tooltipMarkup(content: string, shortcut: string | null) {
  const anchor = {
    getAttribute: (name: string) => (name === 'data-tooltip-shortcut' ? shortcut : null),
  } as HTMLElement;
  return renderToStaticMarkup(createElement(Fragment, null, renderAppTooltip({ content, activeAnchor: anchor })));
}

describe('shared tooltip shortcut layout', () => {
  it('renders the action above a separate muted shortcut line without duplicating text', () => {
    const html = tooltipMarkup('Copy Notion link\n⌥ + ⇧ + C', '⌥ + ⇧ + C');
    expect(html).toContain('<span class="webclipper-tooltip__label">Copy Notion link</span>');
    expect(html).toContain('<span class="webclipper-tooltip__shortcut">⌥ + ⇧ + C</span>');
    expect(html).not.toContain(' · ');
  });

  it('shows shortcut-only hints on the muted line and plain hints unchanged', () => {
    const keyOnly = tooltipMarkup('⌘ + ⇧ + P', '⌘ + ⇧ + P');
    expect(keyOnly).toContain('webclipper-tooltip__shortcut');
    expect(keyOnly).not.toContain('webclipper-tooltip__label');
    expect(tooltipMarkup('Open settings', null)).toBe('Open settings');
  });

  it('renders the label as safe text even when its source contains HTML', () => {
    const html = tooltipMarkup('<img src=x onerror=alert(1)>\nCtrl + K', 'Ctrl + K');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });
});
