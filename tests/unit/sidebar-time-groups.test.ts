import { describe, expect, it } from 'vitest';

import { buildConversationSidebarRenderItems } from '../../src/services/conversations/domain/sidebar-time-groups';

function makeConversation(id: number, lastActivityAt?: number) {
  return {
    id,
    source: 'chatgpt',
    conversationKey: `conv-${id}`,
    title: `Conversation ${id}`,
    lastActivityAt,
  };
}

describe('buildConversationSidebarRenderItems', () => {
  it('groups today, yesterday, recent days, months, prior years, and earlier items in order', () => {
    const now = new Date(2026, 5, 18, 12, 0, 0, 0).getTime();
    const items = buildConversationSidebarRenderItems({
      conversations: [
        makeConversation(1, new Date(2026, 5, 18, 9, 0, 0, 0).getTime()),
        makeConversation(2, new Date(2026, 5, 17, 18, 0, 0, 0).getTime()),
        makeConversation(3, new Date(2026, 5, 14, 11, 0, 0, 0).getTime()),
        makeConversation(4, new Date(2026, 4, 10, 11, 0, 0, 0).getTime()),
        makeConversation(5, new Date(2025, 5, 1, 11, 0, 0, 0).getTime()),
        makeConversation(6, 0),
      ],
      locale: 'en',
      labels: {
        today: 'Today',
        yesterday: 'Yesterday',
        earlier: 'Earlier',
      },
      now,
    });

    const sections = items.filter((item) => item.type === 'section').map((item) => item.label);
    const conversations = items.filter((item) => item.type === 'conversation').map((item) => item.conversation.id);

    expect(sections).toEqual(['Today', 'Yesterday', '6/14', 'May', 'June 2025', 'Earlier']);
    expect(conversations).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats local-midnight boundaries correctly for today and yesterday', () => {
    const now = new Date(2026, 5, 18, 0, 30, 0, 0).getTime();
    const items = buildConversationSidebarRenderItems({
      conversations: [
        makeConversation(1, new Date(2026, 5, 18, 0, 5, 0, 0).getTime()),
        makeConversation(2, new Date(2026, 5, 17, 23, 55, 0, 0).getTime()),
      ],
      locale: 'en',
      labels: {
        today: 'Today',
        yesterday: 'Yesterday',
        earlier: 'Earlier',
      },
      now,
    });

    expect(items.filter((item) => item.type === 'section').map((item) => item.label)).toEqual(['Today', 'Yesterday']);
  });

  it('keeps yesterday and recent-day grouping on local calendar days across DST changes', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      for (const [nowParts, yesterdayParts] of [
        [
          [2026, 2, 9, 12],
          [2026, 2, 8, 12],
        ],
        [
          [2026, 10, 2, 12],
          [2026, 10, 1, 12],
        ],
      ] as const) {
        const now = new Date(...nowParts).getTime();
        const yesterday = new Date(...yesterdayParts).getTime();
        const recent = new Date(nowParts[0], nowParts[1], nowParts[2] - 2, 12).getTime();
        const items = buildConversationSidebarRenderItems({
          conversations: [makeConversation(1, yesterday), makeConversation(2, recent)],
          locale: 'en',
          labels: {
            today: 'Today',
            yesterday: 'Yesterday',
            earlier: 'Earlier',
          },
          now,
        });

        expect(items.filter((item) => item.type === 'section').map((item) => item.label)[0]).toBe('Yesterday');
      }
    } finally {
      if (previousTimeZone == null) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it('does not mislabel future timestamps as today', () => {
    const now = new Date(2026, 5, 18, 12, 0, 0, 0).getTime();
    const items = buildConversationSidebarRenderItems({
      conversations: [
        makeConversation(1, new Date(2026, 5, 19, 8, 0, 0, 0).getTime()),
        makeConversation(2, new Date(2026, 5, 18, 9, 0, 0, 0).getTime()),
      ],
      locale: 'en',
      labels: {
        today: 'Today',
        yesterday: 'Yesterday',
        earlier: 'Earlier',
      },
      now,
    });

    expect(items.filter((item) => item.type === 'section').map((item) => item.label)).toEqual(['6/19', 'Today']);
  });
});
