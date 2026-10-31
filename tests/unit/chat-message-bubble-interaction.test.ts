// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { ChatMessageBubble } from '../../src/ui/shared/ChatMessageBubble';
import { composeThinkingMarkdown } from '@services/shared/thinking-block';

describe('Thinking disclosure interaction', () => {
  it('collapses from the bottom and returns focus to the top summary, which can reopen it', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(ChatMessageBubble, {
            role: 'assistant',
            markdown: composeThinkingMarkdown('First thought.\n\nSecond thought.', 'Final answer.'),
          }),
        );
      });

      const details = host.querySelector('details') as HTMLDetailsElement;
      const summary = details.querySelector('summary') as HTMLElement;
      const collapse = details.querySelector('button[type="button"]') as HTMLButtonElement;
      expect(details.open).toBe(false);
      expect(collapse.textContent?.trim()).toBe('Collapse thinking');

      await act(async () => summary.click());
      expect(details.open).toBe(true);

      await act(async () => collapse.click());
      expect(details.open).toBe(false);
      expect(document.activeElement).toBe(summary);

      await act(async () => summary.click());
      expect(details.open).toBe(true);
      expect(details.nextElementSibling?.textContent).toContain('Final answer.');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
