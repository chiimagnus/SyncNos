import { describe, expect, it } from 'vitest';

import { countConversationMessageImages } from '@services/conversations/domain/image-count';

describe('countConversationMessageImages', () => {
  it('counts rendered Markdown image occurrences and classifies local assets as cached', () => {
    expect(
      countConversationMessageImages([
        {
          contentMarkdown: [
            '![cached](syncnos-asset://12)',
            '![remote](https://example.com/a.png)',
            '![chatgpt](chatgpt-file://file_abc123)',
          ].join('\n'),
        },
      ]),
    ).toEqual({ total: 3, cached: 1, uncached: 2 });
  });

  it('counts duplicate image occurrences instead of unique targets', () => {
    expect(
      countConversationMessageImages([
        {
          contentMarkdown: '![one](syncnos-asset://7)\n![two](syncnos-asset://7)',
        },
      ]),
    ).toEqual({ total: 2, cached: 2, uncached: 0 });
  });

  it('treats malformed local refs and data images as not cached in the SyncNos image cache', () => {
    expect(
      countConversationMessageImages([
        {
          contentMarkdown: '![bad](syncnos-asset://oops)\n![inline](data:image/png;base64,AAAA)',
        },
      ]),
    ).toEqual({ total: 2, cached: 0, uncached: 2 });
  });

  it('ignores image-looking Markdown inside code fences', () => {
    expect(
      countConversationMessageImages([
        {
          contentMarkdown: '```md\n![not-an-image](https://example.com/a.png)\n```',
        },
      ]),
    ).toEqual({ total: 0, cached: 0, uncached: 0 });
  });

  it('sums images across messages and handles empty messages', () => {
    expect(
      countConversationMessageImages([
        { contentMarkdown: '![a](https://example.com/a.png)' },
        {},
        { contentMarkdown: '![b](syncnos-asset://3)' },
      ]),
    ).toEqual({ total: 2, cached: 1, uncached: 1 });
  });
});
