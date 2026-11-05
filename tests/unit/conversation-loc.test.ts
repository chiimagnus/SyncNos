import { describe, expect, it } from 'vitest';

import {
  buildConversationLoc,
  buildConversationRouteFromLoc,
  buildSyncnosLink,
  parseSyncnosLink,
  findLinkedMessageIndex,
  decodeConversationLoc,
  encodeConversationLoc,
} from '@services/shared/conversation-loc';

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

  it('builds HTTPS links to the local SyncNos app without exposing the extension ID', () => {
    const url = buildSyncnosLink({ source: 'ChatGPT', conversationKey: 'session-42', messageKey: 'message-2' });
    expect(url).toMatch(/^https:\/\/chiimagnus\.github\.io\/SyncNos\/#\/open\?/);
    expect(url).not.toContain('chrome-extension://');
    expect(url).not.toContain('chatgpt.com');
    const parsed = parseSyncnosLink(url);
    expect(parsed?.route).toContain('&message=message-2');
    expect(
      findLinkedMessageIndex(`#${parsed?.route}`, { source: 'chatgpt', conversationKey: 'session-42' }, [
        { messageKey: 'message-1' },
        { messageKey: 'message-2' },
      ]),
    ).toBe(1);
    expect(
      findLinkedMessageIndex(`#${parsed?.route}`, { source: 'chatgpt', conversationKey: 'different' }, [
        { messageKey: 'message-2' },
      ]),
    ).toBe(-1);
  });

  it('rejects malformed, conflicting, and off-origin deep links', () => {
    const good = buildSyncnosLink({ source: 'chatgpt', conversationKey: 'session-1', messageKey: 'msg' });
    for (const bad of [
      good.replace('chiimagnus.github.io', 'attacker.example'),
      good.replace('https://', 'http://'),
      good.replace('/SyncNos/', '/syncnos/'),
      good.replace('message=msg', 'message=msg&message=duplicate'),
      good.replace('message=msg', 'message='),
      good + '&extra=true',
      good.replace('loc=', 'loc=bad&loc='),
      good.replace('message=msg', `message=${'a'.repeat(513)}`),
      good.replace('#/open?', '#/settings?'),
      'not-a-url',
    ])
      expect(parseSyncnosLink(bad)).toBeNull();
    expect(findLinkedMessageIndex('#/wrong', { source: 'chatgpt', conversationKey: 'session-1' }, [])).toBe(-1);
  });

  it('builds loc and route helpers', () => {
    const loc = buildConversationLoc('ZAI', 'k:1');
    expect(decodeConversationLoc(loc)).toEqual({ source: 'zai', conversationKey: 'k:1' });
    expect(buildConversationRouteFromLoc(loc)).toBe(`/?loc=${loc}`);
  });
});
