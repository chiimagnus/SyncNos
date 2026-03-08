import { describe, expect, it, vi } from 'vitest';

import {
  DETAIL_HEADER_ACTION_LABELS,
  buildNotionPageUrl,
  normalizeNotionPageId,
  resolveDetailHeaderActions,
} from '../../src/ui/conversations/detail-header-actions';

describe('detail-header-actions', () => {
  it('normalizes a hyphenated Notion page id into the canonical URL form', () => {
    expect(normalizeNotionPageId('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe('0123456789abcdef0123456789abcdef');
    expect(buildNotionPageUrl('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe(
      'https://www.notion.so/0123456789abcdef0123456789abcdef',
    );
  });

  it('returns no actions when the conversation has no Notion page mapping', () => {
    expect(
      resolveDetailHeaderActions({
        conversation: {
          id: 1,
          source: 'chatgpt',
          conversationKey: 'conv-1',
          title: 'Conversation',
        },
      }),
    ).toEqual([]);
  });

  it('resolves Open in Notion and delegates opening through the shared port', async () => {
    const openExternalUrl = vi.fn(async () => true);
    const actions = resolveDetailHeaderActions({
      conversation: {
        id: 2,
        source: 'chatgpt',
        conversationKey: 'conv-2',
        title: 'Conversation',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
      },
      port: { openExternalUrl },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.label).toBe(DETAIL_HEADER_ACTION_LABELS.openInNotion);
    expect(actions[0]?.href).toBe('https://www.notion.so/0123456789abcdef0123456789abcdef');

    await actions[0]?.onTrigger();
    expect(openExternalUrl).toHaveBeenCalledWith('https://www.notion.so/0123456789abcdef0123456789abcdef');
  });
});
