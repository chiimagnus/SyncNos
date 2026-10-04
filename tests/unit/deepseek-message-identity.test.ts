import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_MESSAGE_ID_ATTRIBUTE,
  stampDeepseekMessageIdentities,
} from '@collectors/deepseek/deepseek-message-identity';

describe('DeepSeek durable message DOM boundary', () => {
  it('uses the ready request id rather than the retained negative render key', () => {
    const document = new JSDOM('<main><div data-virtual-list-item-key="-28"></div></main>').window.document;
    const item = document.querySelector('div')! as any;
    item.__reactFiber$test = {
      memoizedProps: {},
      return: {
        memoizedProps: { sessionId: 'session', messageId: -28 },
        alternate: { memoizedProps: { sessionId: 'session', messageId: 27 } },
      },
    };
    stampDeepseekMessageIdentities(document.querySelector('main'), 'session');
    expect(item.getAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE)).toBe('27');
    const mutations: string[] = [];
    item.setAttribute = (name: string) => mutations.push(name);
    stampDeepseekMessageIdentities(document.querySelector('main'), 'session');
    expect(mutations).toEqual([]);
  });

  it('does not accept unready, noninteger, or another session identity', () => {
    for (const props of [
      { sessionId: 'session', messageId: -2 },
      { sessionId: 'other', messageId: 1 },
      { sessionId: 'session', messageId: 1.5 },
    ]) {
      const document = new JSDOM('<main><div data-virtual-list-item-key="-2"></div></main>').window.document;
      const item = document.querySelector('div')! as any;
      item.__reactFiber$test = { memoizedProps: props };
      stampDeepseekMessageIdentities(document.querySelector('main'), 'session');
      expect(item.hasAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE)).toBe(false);
    }
  });

  it('clears stale identity and does not borrow another ancestor message id', () => {
    const document = new JSDOM('<main><div data-virtual-list-item-key="-2"></div></main>').window.document;
    const item = document.querySelector('div')! as any;
    item.setAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE, '27');
    item.__reactFiber$test = {
      memoizedProps: { sessionId: 'session', messageId: -2 },
      return: { memoizedProps: { sessionId: 'session', messageId: 3 } },
    };
    stampDeepseekMessageIdentities(document.querySelector('main'), 'session');
    expect(item.hasAttribute(DEEPSEEK_MESSAGE_ID_ATTRIBUTE)).toBe(false);
  });
});
