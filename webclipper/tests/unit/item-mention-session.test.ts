import { describe, expect, it } from 'vitest';

import { parseMentionTrigger } from '../../src/services/integrations/item-mention/content/mention-trigger-parser';
import { updateMentionSession } from '../../src/services/integrations/item-mention/content/mention-session';

describe('item-mention trigger parser', () => {
  it('parses empty query when cursor is right after $', () => {
    const match = parseMentionTrigger({ text: 'hello $', cursor: 'hello $'.length });
    expect(match).toEqual({ triggerStart: 6, triggerEnd: 7, query: '' });
  });

  it('parses query segment up to cursor', () => {
    const match = parseMentionTrigger({ text: 'x $abc y', cursor: 6 });
    expect(match).toEqual({ triggerStart: 2, triggerEnd: 6, query: 'abc' });
  });

  it('rejects query containing whitespace', () => {
    const match = parseMentionTrigger({ text: '$a b', cursor: 4 });
    expect(match).toBeNull();
  });
});

describe('item-mention session', () => {
  it('closes on close flag but preserves text', () => {
    const text = '$abc';
    let s = updateMentionSession(null, { text, cursor: text.length });
    expect(s?.open).toBe(true);

    s = updateMentionSession(s, { text, cursor: text.length, close: true });
    expect(s?.open).toBe(false);
    expect(s?.closedText).toBe(text);
  });

  it('stays closed after close when only cursor moves', () => {
    const text = '$abc';
    let s = updateMentionSession(null, { text, cursor: text.length, close: true });
    expect(s?.open).toBe(false);

    s = updateMentionSession(s, { text, cursor: 2 });
    expect(s?.open).toBe(false);
  });

  it('re-opens after close when text changes', () => {
    let s = updateMentionSession(null, { text: '$a', cursor: 2, close: true });
    expect(s?.open).toBe(false);

    s = updateMentionSession(s, { text: '$ab', cursor: 3 });
    expect(s?.open).toBe(true);
    expect(s?.query).toBe('ab');
  });
});

