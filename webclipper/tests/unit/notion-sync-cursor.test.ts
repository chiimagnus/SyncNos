import { describe, expect, it } from 'vitest';
import { computeNewMessages, extractCursor, lastMessageCursor } from '@services/sync/notion/notion-sync-cursor';

describe('notion-sync-cursor', () => {
  it('extractCursor returns empty cursor for missing mapping', () => {
    expect(extractCursor(null)).toEqual({
      lastSyncedMessageKey: '',
      lastSyncedSequence: null,
      lastSyncedMessageUpdatedAt: null,
    });
    expect(extractCursor({})).toEqual({
      lastSyncedMessageKey: '',
      lastSyncedSequence: null,
      lastSyncedMessageUpdatedAt: null,
    });
  });

  it('extractCursor keeps lastSyncedMessageUpdatedAt when mapping has it', () => {
    expect(
      extractCursor({
        lastSyncedMessageKey: 'm1',
        lastSyncedSequence: 1,
        lastSyncedMessageUpdatedAt: 123,
      }),
    ).toEqual({
      lastSyncedMessageKey: 'm1',
      lastSyncedSequence: 1,
      lastSyncedMessageUpdatedAt: 123,
    });
  });

  it('computeNewMessages returns empty mode for no messages', () => {
    const res = computeNewMessages([], { lastSyncedMessageKey: 'm1', lastSyncedSequence: 1 });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('empty');
    expect(res.newMessages).toEqual([]);
    expect(res.rebuild).toBe(false);
  });

  it('computeNewMessages appends after key cursor match', () => {
    const messages = [
      { messageKey: 'm1', sequence: 1 },
      { messageKey: 'm2', sequence: 2 },
      { messageKey: 'm3', sequence: 3 },
    ];
    const res = computeNewMessages(messages, { lastSyncedMessageKey: 'm1' });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('append');
    expect(res.newMessages.map((m) => m.messageKey)).toEqual(['m2', 'm3']);
    expect(res.rebuild).toBe(false);
  });

  it('computeNewMessages rebuilds when key cursor missing', () => {
    const messages = [{ messageKey: 'm1', sequence: 1 }];
    const res = computeNewMessages(messages, { lastSyncedMessageKey: 'm0' });
    expect(res.ok).toBe(false);
    expect(res.mode).toBe('cursor_missing');
    expect(res.newMessages).toEqual([]);
    expect(res.rebuild).toBe(true);
  });

  it('computeNewMessages falls back to sequence when messageKey drifts', () => {
    const messages = [
      { messageKey: 'new_key', sequence: 1 },
      { messageKey: 'm2', sequence: 2 },
    ];
    const res = computeNewMessages(messages, { lastSyncedMessageKey: 'old_key', lastSyncedSequence: 1 });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('append');
    expect(res.newMessages.map((m) => m.messageKey)).toEqual(['m2']);
    expect(res.rebuild).toBe(false);
  });

  it('computeNewMessages treats missing anchor as incomplete when local snapshot has not reached stored sequence', () => {
    const messages = [{ messageKey: 'm1', sequence: 1 }];
    const res = computeNewMessages(messages, { lastSyncedMessageKey: 'old_key', lastSyncedSequence: 99 });
    expect(res.ok).toBe(false);
    expect(res.mode).toBe('cursor_incomplete');
    expect(res.rebuild).toBe(false);
  });

  it('computeNewMessages appends by sequence cursor', () => {
    const messages = [
      { messageKey: 'm1', sequence: 1 },
      { messageKey: 'm2', sequence: 2 },
      { messageKey: 'm3', sequence: 3 },
    ];
    const res = computeNewMessages(messages, { lastSyncedSequence: 2 });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('append');
    expect(res.newMessages.map((m) => m.messageKey)).toEqual(['m3']);
    expect(res.rebuild).toBe(false);
  });

  it('computeNewMessages rebuilds when cursor missing', () => {
    const messages = [{ messageKey: 'm1', sequence: 1 }];
    const res = computeNewMessages(messages, null);
    expect(res.ok).toBe(false);
    expect(res.rebuild).toBe(true);
  });

  it('computeNewMessages treats null sequence as missing cursor', () => {
    const messages = [{ messageKey: 'm1', sequence: 1 }];
    const res = computeNewMessages(messages, { lastSyncedMessageKey: '', lastSyncedSequence: null });
    expect(res.ok).toBe(false);
    expect(res.rebuild).toBe(true);
  });

  it('lastMessageCursor picks last message key/sequence', () => {
    const cursor = lastMessageCursor([
      { messageKey: 'm1', sequence: 1, updatedAt: 50 },
      { messageKey: 'm2', sequence: 2, updatedAt: 75 },
    ]);
    expect(cursor.lastSyncedMessageKey).toBe('m2');
    expect(cursor.lastSyncedSequence).toBe(2);
    expect(typeof cursor.lastSyncedAt).toBe('number');
    expect(cursor.lastSyncedMessageUpdatedAt).toBe(75);
  });
});
