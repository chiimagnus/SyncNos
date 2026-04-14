import { describe, expect, it } from 'vitest';

import { reconcileAutoSaveBackfill } from '@services/conversations/content/autosave-backfill-reconciler';

function msg(contentText: string, role = 'assistant', extra?: Record<string, unknown>) {
  return {
    role,
    contentText,
    ...(extra || {}),
  };
}

describe('autosave backfill reconciler', () => {
  it('adds missing tail messages when local window is a page prefix', () => {
    const pageWindow = [msg('A', 'user'), msg('B'), msg('C', 'user'), msg('D')];
    const result = reconcileAutoSaveBackfill({
      localTailMessages: [msg('A', 'user'), msg('B')],
      pageWindowMessages: pageWindow,
      stateKeyHash: 'state_hash',
    });

    expect(result.ok).toBe(true);
    expect(result.pageSignature).toBeTruthy();
    expect(result.addedMessages.map((entry) => entry.contentText)).toEqual(['C', 'D']);
    expect(result.diff.updated).toEqual([]);
    expect(result.diff.removed).toEqual([]);
    expect(result.diff.added).toEqual(result.addedMessages.map((entry) => String(entry.messageKey || '')));
    expect(result.diff.added[0]).toMatch(/^autosave_state_hash_.+_bf1$/);
    expect(result.diff.added[1]).toMatch(/^autosave_state_hash_.+_bf1$/);
  });

  it('adds missing head messages when local window is a page suffix', () => {
    const pageWindow = [msg('A', 'user'), msg('B'), msg('C', 'user'), msg('D')];
    const result = reconcileAutoSaveBackfill({
      localTailMessages: [msg('C', 'user'), msg('D')],
      pageWindowMessages: pageWindow,
      stateKeyHash: 'state_hash',
    });

    expect(result.ok).toBe(true);
    expect(result.pageSignature).toBeTruthy();
    expect(result.addedMessages.map((entry) => entry.contentText)).toEqual(['A', 'B']);
    expect(result.diff.added).toHaveLength(2);
  });

  it('returns ok=false and no writes when there is no reliable overlap', () => {
    const result = reconcileAutoSaveBackfill({
      localTailMessages: [msg('X', 'user'), msg('Y')],
      pageWindowMessages: [msg('A', 'user'), msg('B'), msg('C')],
      stateKeyHash: 'state_hash',
    });

    expect(result.ok).toBe(false);
    expect(result.pageSignature).toBeTruthy();
    expect(result.addedMessages).toEqual([]);
    expect(result.diff).toEqual({ added: [], updated: [], removed: [] });
  });

  it('treats empty local window as first-write backfill', () => {
    const pageWindow = [msg('A', 'user'), msg('B')];
    const result = reconcileAutoSaveBackfill({
      localTailMessages: [],
      pageWindowMessages: pageWindow,
      stateKeyHash: 'state_hash',
    });

    expect(result.ok).toBe(true);
    expect(result.addedMessages.map((entry) => entry.contentText)).toEqual(['A', 'B']);
    expect(result.diff.added).toHaveLength(2);
  });

  it('computes page signature from page window only', () => {
    const pageWindow = [msg('A', 'user'), msg('B')];
    const fromPrefix = reconcileAutoSaveBackfill({
      localTailMessages: [msg('A', 'user')],
      pageWindowMessages: pageWindow,
      stateKeyHash: 'state_hash',
    });
    const fromSuffix = reconcileAutoSaveBackfill({
      localTailMessages: [msg('B')],
      pageWindowMessages: pageWindow,
      stateKeyHash: 'state_hash',
    });

    expect(fromPrefix.pageSignature).toBe(fromSuffix.pageSignature);
  });
});

