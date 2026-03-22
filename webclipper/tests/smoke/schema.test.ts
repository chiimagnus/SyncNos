import { describe, expect, it } from 'vitest';
import * as normalize from '@services/shared/normalize.ts';
import * as incrementalUpdater from '@services/conversations/content/incremental-updater.ts';

describe('smoke', () => {
  it('normalizeText trims and normalizes newlines', () => {
    expect(normalize.normalizeText(' a \r\nb \r c\t \n')).toBe('a\nb\nc');
  });

  it('fnv1a32 is stable', () => {
    expect(normalize.fnv1a32('hello')).toBe(normalize.fnv1a32('hello'));
    expect(normalize.fnv1a32('hello')).not.toBe(normalize.fnv1a32('hello!'));
  });

  it('computeIncremental detects changes by messageKey sequence', () => {
    incrementalUpdater.__resetForTests();
    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'user', contentText: 'a' },
        { role: 'assistant', contentText: 'b' },
      ],
    };
    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'user', contentText: 'a' },
        { role: 'assistant', contentText: 'b' },
      ],
    };
    const snap3 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'user', contentText: 'a' },
        { role: 'assistant', contentText: 'b!' },
      ],
    };

    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true); // seed initial messages
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(false);
    const r3 = incrementalUpdater.computeIncremental(snap3);
    expect(r3.changed).toBe(true);
    expect(r3.diff.updated.length).toBe(1);
  });

  it('computeIncremental detects content update for same messageKey', () => {
    incrementalUpdater.__resetForTests();
    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };
    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi!' }],
    };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true); // seed initial messages
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.updated).toEqual(['m1']);
  });

  it('computeIncremental uses stable fallback keys for auto-save', () => {
    incrementalUpdater.__resetForTests();
    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ role: 'assistant', contentText: 'hello' }],
    };
    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ role: 'assistant', contentText: 'hello!' }],
    };
    const snap3 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ role: 'assistant', contentText: 'hello!!' }],
    };

    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true); // seed initial messages
    expect(r1.diff.added.length).toBe(1);
    const key = String(r1.snapshot.messages[0].messageKey || '');
    expect(key).toMatch(/^autosave_/);

    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.added.length).toBe(0);
    expect(r2.diff.updated).toEqual([key]);
    const r3 = incrementalUpdater.computeIncremental(snap3);
    expect(r3.changed).toBe(true);
    expect(r3.diff.added.length).toBe(0);
    expect(r3.diff.updated).toEqual([key]);
  });

  it('computeIncremental appends only the truly new tail when the window slides (MAX_WINDOW_MESSAGES=200)', () => {
    incrementalUpdater.__resetForTests();

    const mk = (i: number) => ({ role: i % 2 === 0 ? 'user' : 'assistant', contentText: `m${i}` });
    const base = Array.from({ length: 201 }, (_, i) => mk(i)); // windowStart=1 -> last 200 messages
    const snap1 = { conversation: { source: 'debug', conversationKey: 'c1' }, messages: base };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(false); // baseline

    const snap2 = { conversation: { source: 'debug', conversationKey: 'c1' }, messages: [...base, mk(201)] };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.added.length).toBe(1);
    expect(r2.snapshot.messages.length).toBe(1);
    expect(String(r2.snapshot.messages[0].messageKey || '')).toMatch(/^autosave_/);
  });

  it('computeIncremental updates only within the tail window (N=2) on prefix growth', () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'user', contentText: 'A' },
        { role: 'assistant', contentText: 'B' },
        { role: 'assistant', contentText: 'C' },
      ],
    };
    const r1 = incrementalUpdater.computeIncremental(snap1); // seed
    expect(r1.changed).toBe(true);
    const keyB = String(r1.snapshot.messages[1].messageKey || '');
    expect(keyB).toMatch(/^autosave_/);

    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'user', contentText: 'A' },
        { role: 'assistant', contentText: 'B!!!' }, // grows (second-last)
        { role: 'assistant', contentText: 'C' }, // unchanged (last)
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.added.length).toBe(0);
    expect(r2.diff.updated).toEqual([keyB]);
    expect(r2.diff.removed.length).toBe(0);
    expect(r2.snapshot.messages.length).toBe(1);
    expect(String(r2.snapshot.messages[0].contentText || '')).toBe('B!!!');
  });

  it('computeIncremental treats a new message as added (no false tail update)', () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ role: 'assistant', contentText: 'hello' }],
    };
    const r1 = incrementalUpdater.computeIncremental(snap1);
    expect(r1.changed).toBe(true); // seed initial messages

    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { role: 'assistant', contentText: 'hello' },
        { role: 'assistant', contentText: 'new' },
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.updated.length).toBe(0);
    expect(r2.diff.added.length).toBe(1);
    expect(r2.diff.removed.length).toBe(0);
  });

  it('computeIncremental ignores unstable incoming messageKey reuse across window shift', () => {
    incrementalUpdater.__resetForTests();

    const snap1 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { messageKey: 'k0', role: 'user', contentText: 'A' },
        { messageKey: 'k1', role: 'assistant', contentText: 'B' },
        { messageKey: 'k2', role: 'user', contentText: 'C' },
      ],
    };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(true); // seed

    // Window shifts but the collector reuses index-based keys (k0/k1/k2) for different messages.
    const snap2 = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [
        { messageKey: 'k0', role: 'assistant', contentText: 'B' },
        { messageKey: 'k1', role: 'user', contentText: 'C' },
        { messageKey: 'k2', role: 'assistant', contentText: 'D' },
      ],
    };
    const r2 = incrementalUpdater.computeIncremental(snap2);
    expect(r2.changed).toBe(true);
    expect(r2.diff.removed.length).toBe(0);
    expect(r2.diff.added.length).toBe(1);
    expect(String(r2.snapshot.messages[0].messageKey || '')).toMatch(/^autosave_/);
  });

  it('computeIncremental isolates state by source and conversationKey', () => {
    incrementalUpdater.__resetForTests();

    const snap1 = { conversation: { source: 'debug', conversationKey: 'c1' }, messages: [] as any[] };
    expect(incrementalUpdater.computeIncremental(snap1).changed).toBe(false);
    const snap1b = {
      conversation: { source: 'debug', conversationKey: 'c1' },
      messages: [{ role: 'user', contentText: 'A' }],
    };
    const r1b = incrementalUpdater.computeIncremental(snap1b);
    expect(r1b.changed).toBe(true);
    const key1 = String(r1b.snapshot.messages[0].messageKey || '');

    const snap2 = { conversation: { source: 'debug', conversationKey: 'c2' }, messages: [] as any[] };
    expect(incrementalUpdater.computeIncremental(snap2).changed).toBe(false);
    const snap2b = {
      conversation: { source: 'debug', conversationKey: 'c2' },
      messages: [{ role: 'user', contentText: 'B' }],
    };
    const r2b = incrementalUpdater.computeIncremental(snap2b);
    expect(r2b.changed).toBe(true);
    const key2 = String(r2b.snapshot.messages[0].messageKey || '');

    expect(key2).not.toBe(key1);
  });

  it('computeIncremental detects title/url updates even without message changes', () => {
    incrementalUpdater.__resetForTests();
    const base = {
      conversation: { source: 'debug', conversationKey: 'c1', title: 't1', url: 'https://a' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };
    const sameMsgsNewTitle = {
      conversation: { source: 'debug', conversationKey: 'c1', title: 't2', url: 'https://a' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };
    const sameMsgsNewUrl = {
      conversation: { source: 'debug', conversationKey: 'c1', title: 't2', url: 'https://b' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true); // seed
    expect(incrementalUpdater.computeIncremental(sameMsgsNewTitle).changed).toBe(true);
    expect(incrementalUpdater.computeIncremental(sameMsgsNewUrl).changed).toBe(true);
  });

  it('computeIncremental does not treat empty title/url as an update for same conversationKey', () => {
    incrementalUpdater.__resetForTests();
    const base = {
      conversation: { source: 'debug', conversationKey: 'c1', title: 't1', url: 'https://a' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };
    const emptyMeta = {
      conversation: { source: 'debug', conversationKey: 'c1', title: '', url: '' },
      messages: [{ messageKey: 'm1', role: 'user', contentText: 'hi' }],
    };

    expect(incrementalUpdater.computeIncremental(base).changed).toBe(true); // seed
    expect(incrementalUpdater.computeIncremental(emptyMeta).changed).toBe(false);
    // And it should carry forward the previous non-empty values.
    expect(emptyMeta.conversation.title).toBe('t1');
    expect(emptyMeta.conversation.url).toBe('https://a');
  });
});
