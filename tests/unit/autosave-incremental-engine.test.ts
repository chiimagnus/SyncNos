import { describe, expect, it } from 'vitest';

import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function snapshot(key: string, messages: any[], meta?: { title?: string; url?: string }) {
  return {
    conversation: { source: 'debug', conversationKey: key, title: meta?.title || '', url: meta?.url || '' },
    messages,
  };
}

function prepareCommitted(engine: ReturnType<typeof createAutoSaveIncrementalEngine>, input: any) {
  const preparation = engine.prepare(input);
  preparation.commit();
  return preparation;
}

describe('autosave incremental engine transactional baseline', () => {
  it('retries the same short seed until commit, then becomes a no-op', () => {
    const engine = createAutoSaveIncrementalEngine();
    const input = snapshot('seed', [
      { role: 'user', contentText: 'a' },
      { role: 'assistant', contentText: 'b' },
    ]);

    const first = engine.prepare(input);
    const retry = engine.prepare(input);
    expect(first.changed).toBe(true);
    expect(retry.changed).toBe(true);
    expect(retry.diff.added).toEqual(first.diff.added);
    expect(retry.snapshot.messages.map((m: any) => m.messageKey)).toEqual(
      first.snapshot.messages.map((m: any) => m.messageKey),
    );

    expect(first.commit()).toBe(true);
    const afterCommit = engine.prepare(input);
    expect(afterCommit.changed).toBe(false);
    expect(afterCommit.snapshot.messages).toEqual([]);
  });

  it('retries an append delta until commit, then does not repeat it', () => {
    const engine = createAutoSaveIncrementalEngine();
    const base = snapshot('append', [{ role: 'user', contentText: 'A' }]);
    prepareCommitted(engine, base);
    const next = snapshot('append', [
      { role: 'user', contentText: 'A' },
      { role: 'assistant', contentText: 'B' },
    ]);

    const first = engine.prepare(next);
    const retry = engine.prepare(next);
    expect(first.changed).toBe(true);
    expect(first.diff.added).toHaveLength(1);
    expect(retry.diff.added).toEqual(first.diff.added);
    expect(first.commit()).toBe(true);
    expect(engine.prepare(next).changed).toBe(false);
  });

  it('advances prefix-growth tail state only after commit', () => {
    const engine = createAutoSaveIncrementalEngine();
    const base = snapshot('prefix', [
      { role: 'user', contentText: 'A' },
      { role: 'assistant', contentText: 'B' },
      { role: 'assistant', contentText: 'C' },
    ]);
    const seed = engine.prepare(base);
    const keyB = seed.snapshot.messages[1].messageKey;
    seed.commit();

    const grown = snapshot('prefix', [
      { role: 'user', contentText: 'A' },
      { role: 'assistant', contentText: 'B!!!' },
      { role: 'assistant', contentText: 'C' },
    ]);
    const first = engine.prepare(grown);
    expect(first.diff.updated).toEqual([keyB]);
    expect(engine.prepare(grown).diff.updated).toEqual([keyB]);
    first.commit();
    expect(engine.prepare(grown).changed).toBe(false);
  });

  it('commits a long-conversation changed=false observation baseline before detecting the next append', () => {
    const engine = createAutoSaveIncrementalEngine();
    const mk = (i: number) => ({ role: i % 2 === 0 ? 'user' : 'assistant', contentText: `m${i}` });
    const base = Array.from({ length: 201 }, (_, i) => mk(i));
    const initial = engine.prepare(snapshot('long', base));
    expect(initial.changed).toBe(false);
    expect(initial.snapshot.messages).toEqual([]);
    expect(initial.commit()).toBe(true);

    const appended = engine.prepare(snapshot('long', [...base, mk(201)]));
    expect(appended.changed).toBe(true);
    expect(appended.diff.added).toHaveLength(1);
    expect(appended.snapshot.messages).toHaveLength(1);
    expect(appended.snapshot.messages[0].contentText).toBe('m201');
  });

  it('does not leak an uncommitted incoming-key overlay', () => {
    const engine = createAutoSaveIncrementalEngine();
    const firstInput = snapshot('overlay', [{ messageKey: 'k1', role: 'assistant', contentText: 'hello' }]);
    const first = engine.prepare(firstInput);
    expect(first.snapshot.messages[0].messageKey).toBe('k1');

    const incompatible = snapshot('overlay', [{ messageKey: 'k1', role: 'user', contentText: 'different' }]);
    const second = engine.prepare(incompatible);
    expect(second.changed).toBe(true);
    expect(second.snapshot.messages[0].messageKey).toBe('k1');
    expect(first.commit()).toBe(true);

    // Once the first preparation is actually committed, the same incompatible reuse is no longer accepted as stable.
    // With no safe overlap this observation is intentionally a no-op rather than manufacturing a duplicate delta.
    const after = engine.prepare(incompatible);
    expect(after.changed).toBe(false);
    expect(after.snapshot.messages).toEqual([]);
  });

  it('double commit is idempotent', () => {
    const engine = createAutoSaveIncrementalEngine();
    const preparation = engine.prepare(snapshot('double', [{ role: 'user', contentText: 'A' }]));
    expect(preparation.commit()).toBe(true);
    expect(preparation.commit()).toBe(false);
  });

  it('rejects a stale first commit after another preparation advances the same revision', () => {
    const engine = createAutoSaveIncrementalEngine();
    prepareCommitted(engine, snapshot('stale', [{ role: 'user', contentText: 'A' }]));
    const oldPreparation = engine.prepare(
      snapshot('stale', [
        { role: 'user', contentText: 'A' },
        { role: 'assistant', contentText: 'B' },
      ]),
    );
    const newerPreparation = engine.prepare(
      snapshot('stale', [
        { role: 'user', contentText: 'A' },
        { role: 'assistant', contentText: 'C' },
      ]),
    );
    expect(newerPreparation.commit()).toBe(true);
    expect(() => oldPreparation.commit()).toThrow('autosave_incremental_prepare_stale');
  });

  it('keeps metadata-only changes pending until commit', () => {
    const engine = createAutoSaveIncrementalEngine();
    const base = snapshot('meta', [{ messageKey: 'm1', role: 'user', contentText: 'hi' }], {
      title: 't1',
      url: 'https://a',
    });
    prepareCommitted(engine, base);

    const changedInput = snapshot('meta', [{ messageKey: 'm1', role: 'user', contentText: 'hi' }], {
      title: 't2',
      url: 'https://b',
    });
    const first = engine.prepare(changedInput);
    expect(first.changed).toBe(true);
    expect(first.diff).toEqual({ added: [], updated: [], removed: [] });
    expect(first.snapshot.messages).toEqual([]);
    expect(engine.prepare(changedInput).changed).toBe(true);
    first.commit();
    expect(engine.prepare(changedInput).changed).toBe(false);
  });

  it('preserves the 200-message sliding window append behavior', () => {
    const engine = createAutoSaveIncrementalEngine();
    const mk = (i: number) => ({ role: i % 2 === 0 ? 'user' : 'assistant', contentText: `m${i}` });
    const base = Array.from({ length: 201 }, (_, i) => mk(i));
    prepareCommitted(engine, snapshot('window', base));
    const next = engine.prepare(snapshot('window', [...base, mk(201)]));
    expect(next.changed).toBe(true);
    expect(next.diff.added).toHaveLength(1);
    expect(next.snapshot.messages).toHaveLength(1);
  });

  it('does not advance the message window on an unanchored no-overlap observation', () => {
    const engine = createAutoSaveIncrementalEngine();
    const mk = (prefix: string, i: number) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      contentText: `${prefix}${i}`,
    });
    const base = Array.from({ length: 201 }, (_, i) => mk('m', i));
    const foreign = Array.from({ length: 201 }, (_, i) => mk('x', i));
    prepareCommitted(engine, snapshot('no-overlap', base));
    const noOverlap = engine.prepare(snapshot('no-overlap', foreign));
    expect(noOverlap.changed).toBe(false);
    noOverlap.commit();

    const resumed = engine.prepare(snapshot('no-overlap', [...base, mk('m', 201)]));
    expect(resumed.changed).toBe(true);
    expect(resumed.diff.added).toHaveLength(1);
    expect(resumed.snapshot.messages[0].contentText).toBe('m201');
  });

  it('treats a new message as added instead of a false tail update', () => {
    const engine = createAutoSaveIncrementalEngine();
    prepareCommitted(engine, snapshot('new-message', [{ role: 'assistant', contentText: 'hello' }]));
    const result = engine.prepare(
      snapshot('new-message', [
        { role: 'assistant', contentText: 'hello' },
        { role: 'assistant', contentText: 'new' },
      ]),
    );
    expect(result.diff.updated).toEqual([]);
    expect(result.diff.added).toHaveLength(1);
  });

  it('keeps fallback_ keys unstable and appends only the real delta', () => {
    const engine = createAutoSaveIncrementalEngine();
    const seed = engine.prepare(
      snapshot('fallback', [
        { messageKey: 'fallback_a1', role: 'user', contentText: 'A' },
        { messageKey: 'fallback_a2', role: 'assistant', contentText: 'B' },
        { messageKey: 'fallback_a3', role: 'user', contentText: 'C' },
      ]),
    );
    expect(seed.diff.added.every((key) => key.startsWith('autosave_'))).toBe(true);
    seed.commit();

    const next = engine.prepare(
      snapshot('fallback', [
        { messageKey: 'fallback_b1', role: 'assistant', contentText: 'B' },
        { messageKey: 'fallback_b2', role: 'user', contentText: 'C' },
        { messageKey: 'fallback_b3', role: 'assistant', contentText: 'D' },
      ]),
    );
    expect(next.diff.updated).toEqual([]);
    expect(next.diff.added).toHaveLength(1);
    expect(next.snapshot.messages[0].contentText).toBe('D');
  });

  it('ignores unstable reused incoming keys across a shifted window', () => {
    const engine = createAutoSaveIncrementalEngine();
    prepareCommitted(
      engine,
      snapshot('reuse', [
        { messageKey: 'k0', role: 'user', contentText: 'A' },
        { messageKey: 'k1', role: 'assistant', contentText: 'B' },
        { messageKey: 'k2', role: 'user', contentText: 'C' },
      ]),
    );
    const result = engine.prepare(
      snapshot('reuse', [
        { messageKey: 'k0', role: 'assistant', contentText: 'B' },
        { messageKey: 'k1', role: 'user', contentText: 'C' },
        { messageKey: 'k2', role: 'assistant', contentText: 'D' },
      ]),
    );
    expect(result.changed).toBe(true);
    expect(result.diff.added).toHaveLength(1);
    expect(result.snapshot.messages[0].messageKey).toMatch(/^autosave_/);
  });

  it('isolates state by source/conversation identity', () => {
    const engine = createAutoSaveIncrementalEngine();
    const c1 = engine.prepare(snapshot('c1', [{ role: 'user', contentText: 'A' }]));
    const c2 = engine.prepare(snapshot('c2', [{ role: 'user', contentText: 'B' }]));
    expect(c1.snapshot.messages[0].messageKey).not.toBe(c2.snapshot.messages[0].messageKey);
    c1.commit();
    c2.commit();
    expect(engine.prepare(snapshot('c1', [{ role: 'user', contentText: 'A' }])).changed).toBe(false);
    expect(engine.prepare(snapshot('c2', [{ role: 'user', contentText: 'B' }])).changed).toBe(false);
  });

  it('does not mutate the caller snapshot across an uncommitted retry', () => {
    const engine = createAutoSaveIncrementalEngine();
    const input = snapshot('pure', [
      { role: 'user', contentText: 'A' },
      { role: 'assistant', contentText: 'B' },
    ]);
    const original = clone(input);
    const first = engine.prepare(input);
    expect(input).toEqual(original);
    const second = engine.prepare(input);
    expect(input).toEqual(original);
    expect(second.diff).toEqual(first.diff);
    expect(second.snapshot.messages.map((m: any) => m.messageKey)).toEqual(
      first.snapshot.messages.map((m: any) => m.messageKey),
    );
  });

  it('explicitly carries forward empty title/url in the effective draft without mutating input', () => {
    const engine = createAutoSaveIncrementalEngine();
    prepareCommitted(
      engine,
      snapshot('carry', [{ messageKey: 'm1', role: 'user', contentText: 'hi' }], {
        title: 't1',
        url: 'https://a',
      }),
    );
    const input = snapshot('carry', [{ messageKey: 'm1', role: 'user', contentText: 'hi' }]);
    const original = clone(input);
    const preparation = engine.prepare(input);
    expect(preparation.changed).toBe(false);
    expect(preparation.snapshot.conversation.title).toBe('t1');
    expect(preparation.snapshot.conversation.url).toBe('https://a');
    expect(preparation.snapshot.messages).toEqual([]);
    expect(input).toEqual(original);
  });
});
