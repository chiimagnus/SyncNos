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
      expect(details.open).toBe(false);
      expect(details.querySelector('button[type="button"]')).toBeNull();
      expect(details.textContent).toBe('Thinking');
      expect(details.nextElementSibling?.textContent).toContain('Final answer.');

      await act(async () => {
        summary.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(details.open).toBe(true);
      const collapse = details.querySelector('button[type="button"]') as HTMLButtonElement;
      expect(collapse.textContent?.trim()).toBe('Collapse thinking');
      expect(details.textContent).toContain('First thought.');

      await act(async () => {
        collapse.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(details.open).toBe(false);
      expect(details.textContent).toBe('Thinking');
      expect(document.activeElement).toBe(summary);

      await act(async () => {
        summary.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(details.open).toBe(true);
      expect(details.textContent).toContain('Second thought.');
      expect(details.nextElementSibling?.textContent).toContain('Final answer.');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('uses the same Markdown typography for expanded thinking and final answers in each reading profile', async () => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      for (const readingProfile of ['medium', 'notion', 'book']) {
        await act(async () => {
          root.render(
            createElement(ChatMessageBubble, {
              key: readingProfile,
              role: 'assistant',
              readingProfile,
              markdown: composeThinkingMarkdown('**Thought**\n\n```ts\nconst x = 1;\n```', '**Answer**'),
            }),
          );
        });
        const details = host.querySelector('details') as HTMLDetailsElement;
        expect(details.querySelector('pre')).toBeNull();
        await act(async () => {
          details.querySelector('summary')!.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const thinkingContent = details.querySelector('div') as HTMLDivElement;
        const answerContent = details.nextElementSibling as HTMLDivElement;
        expect(thinkingContent.className).toBe(answerContent.className);
        expect(thinkingContent.querySelector('strong')?.textContent).toBe('Thought');
        expect(thinkingContent.querySelector('pre')).not.toBeNull();
        expect(answerContent.querySelector('strong')?.textContent).toBe('Answer');
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
