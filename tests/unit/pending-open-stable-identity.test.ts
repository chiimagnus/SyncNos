import { beforeEach, describe, expect, it } from 'vitest';

import { consumePendingOpenConversation, setPendingOpenConversation } from '@ui/conversations/pending-open';

const KEY = 'webclipper_pending_open_conversation_id';

class SessionStorageStub {
  private readonly values = new Map<string, string>();

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const storage = new SessionStorageStub();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });

describe('pending-open stable identity', () => {
  beforeEach(() => storage.clear());

  it('writes only source + conversationKey for new pending navigation', () => {
    setPendingOpenConversation({ source: ' ChatGPT ', conversationKey: 'thread-1' });

    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ source: 'chatgpt', conversationKey: 'thread-1' });
    expect(consumePendingOpenConversation()).toEqual({ source: 'chatgpt', conversationKey: 'thread-1' });
    expect(storage.getItem(KEY)).toBe(null);
  });

  it('consumes legacy plain numeric state as an explicit IDB-only candidate', () => {
    storage.setItem(KEY, '42');
    expect(consumePendingOpenConversation()).toEqual({ legacyIdbConversationId: 42 });
    expect(storage.getItem(KEY)).toBe(null);
  });

  it('consumes legacy partial JSON state without promoting it to a stable identity', () => {
    storage.setItem(KEY, JSON.stringify({ conversationId: 43 }));
    expect(consumePendingOpenConversation()).toEqual({ legacyIdbConversationId: 43 });
    expect(storage.getItem(KEY)).toBe(null);
  });

  it('drops malformed or incomplete state after one read', () => {
    storage.setItem(KEY, JSON.stringify({ source: 'chatgpt' }));
    expect(consumePendingOpenConversation()).toBe(null);
    expect(storage.getItem(KEY)).toBe(null);

    storage.setItem(KEY, '{bad json');
    expect(consumePendingOpenConversation()).toBe(null);
    expect(storage.getItem(KEY)).toBe(null);
  });
});
