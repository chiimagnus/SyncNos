import { describe, expect, it } from 'vitest';

import {
  buildConversationLoc,
  buildConversationRouteFromLoc,
  decodeConversationLoc,
  encodeConversationLoc,
} from '../../src/shared/conversation-loc';

describe('conversation-loc', () => {
  it('encodes and decodes loc with special characters', () => {
    const loc = encodeConversationLoc({
      source: 'Notion ',
      conversationKey: ' key:/?&= 空格 中文 𠮷 ',
    });
    expect(loc).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(decodeConversationLoc(loc)).toEqual({
      source: 'notion',
      conversationKey: 'key:/?&= 空格 中文 𠮷',
    });
  });

  it('supports conversationKey containing the delimiter', () => {
    const loc = encodeConversationLoc({
      source: 'ChatGPT',
      conversationKey: 'a||b||c',
    });
    expect(decodeConversationLoc(loc)).toEqual({ source: 'chatgpt', conversationKey: 'a||b||c' });
  });

  it('returns null for invalid loc inputs', () => {
    expect(decodeConversationLoc(null)).toBeNull();
    expect(decodeConversationLoc(undefined)).toBeNull();
    expect(decodeConversationLoc(123)).toBeNull();
    expect(decodeConversationLoc('')).toBeNull();
    expect(decodeConversationLoc('not-base64url***')).toBeNull();
  });

  it('returns null when payload is missing fields', () => {
    expect(
      decodeConversationLoc(
        encodeConversationLoc({
          source: '',
          conversationKey: 'x',
        }),
      ),
    ).toBeNull();

    expect(
      decodeConversationLoc(
        encodeConversationLoc({
          source: 'x',
          conversationKey: '',
        }),
      ),
    ).toBeNull();
  });

  it('builds loc and route helpers', () => {
    const loc = buildConversationLoc('ZAI', 'k:1');
    expect(decodeConversationLoc(loc)).toEqual({ source: 'zai', conversationKey: 'k:1' });
    expect(buildConversationRouteFromLoc(loc)).toBe(`/?loc=${loc}`);
  });
});

