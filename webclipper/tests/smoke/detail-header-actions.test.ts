import { describe, expect, it, vi } from 'vitest';

const resolveObsidianOpenTargetMock = vi.fn(async () => ({
  available: false,
  label: 'Open in Obsidian',
  availabilityState: 'not-synced',
  error: { code: 'note_not_found', message: 'missing' },
}));
const openObsidianTargetMock = vi.fn(async () => ({ ok: true }));

vi.mock('@services/integrations/openin/obsidian-open-target', () => ({
  resolveObsidianOpenTarget: (...args: any[]) => resolveObsidianOpenTargetMock(...args),
  openObsidianTarget: (...args: any[]) => openObsidianTargetMock(...args),
  waitForDelay: vi.fn(async () => {}),
  reportObsidianOpenError: vi.fn(),
}));

import { DETAIL_HEADER_ACTION_LABELS, resolveDetailHeaderActions } from '@services/integrations/detail-header-actions';
import { buildNotionPageUrl, normalizeNotionPageId } from '@services/integrations/openin/openin-detail-header-actions';

describe('detail-header-actions', () => {
  it('normalizes a hyphenated Notion page id into the canonical URL form', () => {
    expect(normalizeNotionPageId('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe('0123456789abcdef0123456789abcdef');
    expect(buildNotionPageUrl('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe(
      'https://www.notion.so/0123456789abcdef0123456789abcdef',
    );
  });

  it('returns no actions when neither Notion nor Obsidian is available', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValueOnce({
      available: false,
      label: 'Open in Obsidian',
      availabilityState: 'not-synced',
      error: { code: 'note_not_found', message: 'missing' },
    });

    await expect(
      resolveDetailHeaderActions({
        conversation: {
          id: 1,
          source: 'chatgpt',
          conversationKey: 'conv-1',
          title: 'Conversation',
        },
      }),
    ).resolves.toEqual([]);
  });

  it('resolves Open in Notion and delegates opening through the shared port', async () => {
    const openExternalUrl = vi.fn(async () => true);
    resolveObsidianOpenTargetMock.mockResolvedValueOnce({
      available: false,
      label: 'Open in Obsidian',
      availabilityState: 'not-synced',
      error: { code: 'note_not_found', message: 'missing' },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 2,
        source: 'chatgpt',
        conversationKey: 'conv-2',
        title: 'Conversation',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
      },
      port: {
        openExternalUrl,
        launchProtocolUrl: vi.fn(async () => true),
        wait: vi.fn(async () => {}),
        reportError: vi.fn(),
      },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.label).toBe(DETAIL_HEADER_ACTION_LABELS.openInNotion);
    expect(actions[0]?.href).toBe('https://www.notion.so/0123456789abcdef0123456789abcdef');

    await actions[0]?.onTrigger();
    expect(openExternalUrl).toHaveBeenCalledWith('https://www.notion.so/0123456789abcdef0123456789abcdef');
  });

  it('resolves an Obsidian-only destination when the note target is available', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValueOnce({
      available: true,
      label: 'Open in Obsidian',
      availabilityState: 'ready',
      trigger: {
        provider: 'obsidian',
        openMode: 'rest-api',
        conversation: {
          id: 3,
          source: 'chatgpt',
          conversationKey: 'conv-3',
          title: 'Conversation',
        },
        resolvedNotePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        launchBeforeRetry: false,
        retryPolicy: { maxAttempts: 3, launchDelayMs: 1200, retryDelayMs: 750 },
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 3,
        source: 'chatgpt',
        conversationKey: 'conv-3',
        title: 'Conversation',
      },
      port: {
        openExternalUrl: vi.fn(async () => true),
        launchProtocolUrl: vi.fn(async () => true),
        wait: vi.fn(async () => {}),
        reportError: vi.fn(),
      },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.provider).toBe('obsidian');
    expect(actions[0]?.label).toBe(DETAIL_HEADER_ACTION_LABELS.openInObsidian);
  });

  it('resolves both Notion and Obsidian when both destinations are available', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValueOnce({
      available: true,
      label: 'Open in Obsidian',
      availabilityState: 'ready',
      trigger: {
        provider: 'obsidian',
        openMode: 'rest-api',
        conversation: {
          id: 4,
          source: 'chatgpt',
          conversationKey: 'conv-4',
          title: 'Conversation',
        },
        resolvedNotePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        launchBeforeRetry: false,
        retryPolicy: { maxAttempts: 3, launchDelayMs: 1200, retryDelayMs: 750 },
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 4,
        source: 'chatgpt',
        conversationKey: 'conv-4',
        title: 'Conversation',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
      },
      port: {
        openExternalUrl: vi.fn(async () => true),
        launchProtocolUrl: vi.fn(async () => true),
        wait: vi.fn(async () => {}),
        reportError: vi.fn(),
      },
    });

    expect(actions.map((action) => action.provider)).toEqual(['notion', 'obsidian']);
  });

  it('keeps the Notion action when the Obsidian capability probe throws', async () => {
    resolveObsidianOpenTargetMock.mockRejectedValueOnce(new Error('probe failed'));

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 5,
        source: 'chatgpt',
        conversationKey: 'conv-5',
        title: 'Conversation',
        notionPageId: '01234567-89ab-cdef-0123-456789abcdef',
      },
      port: {
        openExternalUrl: vi.fn(async () => true),
        launchProtocolUrl: vi.fn(async () => true),
        wait: vi.fn(async () => {}),
        reportError: vi.fn(),
      },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.provider).toBe('notion');
  });

  it('returns a disabled API status action when Obsidian is unavailable', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValueOnce({
      available: false,
      label: 'Open in Obsidian',
      availabilityState: 'api-unavailable',
      error: { code: 'network_error', message: 'fetch failed' },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 7,
        source: 'chatgpt',
        conversationKey: 'conv-7',
        title: 'Conversation',
      },
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.provider).toBe('obsidian');
    expect(actions[0]?.label).toBe('Obsidian API not connected');
    expect(actions[0]?.disabled).toBe(true);
  });
});
