import { describe, expect, it } from 'vitest';
import { buildSyncnosObject, readSyncnosObject } from '@services/sync/shared/remote-markdown-metadata';

describe('remote-markdown-metadata', () => {
  it('rejects missing, mismatched, or incomplete identity metadata', () => {
    expect(readSyncnosObject(null)).toMatchObject({ ok: false, reason: 'missing' });
    expect(readSyncnosObject({ syncnos: { schemaVersion: 2 } })).toMatchObject({
      ok: false,
      reason: 'schema_mismatch',
    });
    expect(readSyncnosObject({ syncnos: { schemaVersion: 1, source: '', conversationKey: 'y' } })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(readSyncnosObject({ syncnos: { schemaVersion: 1, source: 'x', conversationKey: '' } })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('preserves Obsidian lastSyncedAt when supplied', () => {
    const syncnos = buildSyncnosObject({
      conversation: { source: 'x', conversationKey: 'y' },
      lastSyncedAt: 10,
    });

    expect(syncnos).toEqual({ source: 'x', conversationKey: 'y', schemaVersion: 1, lastSyncedAt: 10 });
    expect(readSyncnosObject({ syncnos })).toEqual({
      ok: true,
      data: { source: 'x', conversationKey: 'y', schemaVersion: 1, lastSyncedAt: 10 },
    });
  });

  it('builds deterministic identity metadata without a dynamic timestamp', () => {
    const input = { conversation: { source: 'github-fixture', conversationKey: 'conversation-1' } };
    const first = buildSyncnosObject(input);
    const second = buildSyncnosObject({ ...input, lastSyncedAt: null });

    expect(first).toEqual({ source: 'github-fixture', conversationKey: 'conversation-1', schemaVersion: 1 });
    expect(second).toEqual(first);
    expect(first).not.toHaveProperty('lastSyncedAt');
  });

  it('requires source and conversationKey when building metadata', () => {
    expect(() => buildSyncnosObject({ conversation: { source: 'x' } })).toThrow('missing source or conversationKey');
    expect(() => buildSyncnosObject({ conversation: { conversationKey: 'y' } })).toThrow(
      'missing source or conversationKey',
    );
  });
});
