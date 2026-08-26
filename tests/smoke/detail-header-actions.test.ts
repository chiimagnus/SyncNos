import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveObsidianOpenTargetMock = vi.fn();
const openObsidianTargetMock = vi.fn();
const getSyncMappingByConversationMock = vi.fn();
const writeTextToClipboardMock = vi.fn();
const formatConversationMarkdownMock = vi.fn();

vi.mock('@services/integrations/openin/obsidian-open-target', () => ({
  resolveObsidianOpenTarget: (...args: any[]) => resolveObsidianOpenTargetMock(...args),
  openObsidianTarget: (...args: any[]) => openObsidianTargetMock(...args),
  waitForDelay: vi.fn(async () => {}),
  reportObsidianOpenError: vi.fn(),
}));

vi.mock('@services/conversations/data/storage-idb', () => ({
  getSyncMappingByConversation: (...args: any[]) => getSyncMappingByConversationMock(...args),
}));

vi.mock('@services/shared/clipboard', () => ({
  writeTextToClipboard: (...args: any[]) => writeTextToClipboardMock(...args),
}));

vi.mock('@services/integrations/chatwith/chatwith-settings', () => ({
  formatConversationMarkdownForExternalOutput: (...args: any[]) => formatConversationMarkdownMock(...args),
}));

import { t } from '@i18n';
import { DETAIL_HEADER_ACTION_LABELS, resolveDetailHeaderActions } from '@services/integrations/detail-header-actions';
import { buildNotionPageUrl, normalizeNotionPageId } from '@services/integrations/openin/openin-detail-header-actions';

const NOTION_PAGE_ID = '01234567-89ab-cdef-0123-456789abcdef';
const OTHER_NOTION_PAGE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function unavailableObsidian() {
  return {
    available: false,
    label: 'Open in Obsidian',
    availabilityState: 'not-synced',
    error: { code: 'note_not_found', message: 'missing' },
  };
}

function readyObsidian(conversationId: number) {
  return {
    available: true,
    label: 'Open in Obsidian',
    availabilityState: 'ready',
    trigger: {
      provider: 'obsidian',
      openMode: 'rest-api',
      conversation: {
        id: conversationId,
        source: 'chatgpt',
        conversationKey: `conv-${conversationId}`,
        title: 'Conversation',
      },
      resolvedNotePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
      launchBeforeRetry: false,
      retryPolicy: { maxAttempts: 3, launchDelayMs: 1200, retryDelayMs: 750 },
    },
  };
}

function createPort() {
  return {
    openExternalUrl: vi.fn(async () => true),
    launchProtocolUrl: vi.fn(async () => true),
    wait: vi.fn(async () => {}),
    reportError: vi.fn(),
  };
}

function bySlot(actions: Awaited<ReturnType<typeof resolveDetailHeaderActions>>, slot: string) {
  return actions.filter((action) => action.slot === slot);
}

function byId(actions: Awaited<ReturnType<typeof resolveDetailHeaderActions>>, id: string) {
  return actions.find((action) => action.id === id);
}

describe('detail-header-actions', () => {
  beforeEach(() => {
    resolveObsidianOpenTargetMock.mockReset();
    resolveObsidianOpenTargetMock.mockResolvedValue(unavailableObsidian());
    openObsidianTargetMock.mockReset();
    openObsidianTargetMock.mockResolvedValue({ ok: true });
    getSyncMappingByConversationMock.mockReset();
    getSyncMappingByConversationMock.mockResolvedValue(null);
    writeTextToClipboardMock.mockReset();
    writeTextToClipboardMock.mockResolvedValue(true);
    formatConversationMarkdownMock.mockReset();
    formatConversationMarkdownMock.mockResolvedValue('# exact markdown\n');
  });

  it('normalizes a hyphenated Notion page id into the canonical URL form', () => {
    expect(normalizeNotionPageId('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe('0123456789abcdef0123456789abcdef');
    expect(buildNotionPageUrl('01234567-89AB-CDEF-0123-456789ABCDEF')).toBe(
      'https://www.notion.so/0123456789abcdef0123456789abcdef',
    );
  });

  it('builds an app deep-link when workspace slug is available', () => {
    expect(
      buildNotionPageUrl(NOTION_PAGE_ID, {
        workspaceSlug: 'chiimagnus',
      }),
    ).toBe('https://app.notion.com/p/chiimagnus/0123456789abcdef0123456789abcdef');
  });

  it('returns no open/copy provider actions when no synced destination is available', async () => {
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 1,
        source: 'chatgpt',
        conversationKey: 'conv-1',
        title: 'Conversation',
      },
    });

    expect(bySlot(actions, 'open')).toEqual([]);
    expect(bySlot(actions, 'copy')).toEqual([]);
    expect(bySlot(actions, 'tools').map((action) => action.id)).toEqual(['copy-full-markdown', 'open-original']);
    expect(byId(actions, 'copy-full-markdown')?.disabled).toBe(true);
    expect(byId(actions, 'open-original')?.disabled).toBe(true);
    expect(getSyncMappingByConversationMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Open in Notion and derives a copy action with the exact same href', async () => {
    const port = createPort();
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 2,
        source: 'chatgpt',
        conversationKey: 'conv-2',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
        notionWorkspaceSlug: 'chiimagnus',
      },
      port,
    });

    const openAction = byId(actions, 'open-in-notion');
    const copyAction = byId(actions, 'copy-notion-link');
    expect(bySlot(actions, 'open')).toHaveLength(1);
    expect(bySlot(actions, 'copy')).toHaveLength(1);
    expect(openAction?.label).toBe(DETAIL_HEADER_ACTION_LABELS.openInNotion);
    expect(openAction?.href).toBe('https://app.notion.com/p/chiimagnus/0123456789abcdef0123456789abcdef');
    expect(copyAction?.href).toBe(openAction?.href);
    expect(copyAction?.afterTriggerLabel).toBe('Copied');

    await openAction?.onTrigger();
    expect(port.openExternalUrl).toHaveBeenCalledWith(openAction?.href);

    await copyAction?.onTrigger();
    expect(writeTextToClipboardMock).toHaveBeenCalledTimes(1);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith(openAction?.href);
  });

  it('keeps Open in Feishu and derives a Feishu copy action', async () => {
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 3,
        source: 'chatgpt',
        conversationKey: 'conv-3',
        title: 'Conversation',
        feishuDocId: 'doc-123',
      },
      port: createPort(),
    });

    const openAction = byId(actions, 'open-in-feishu');
    const copyAction = byId(actions, 'copy-feishu-link');
    expect(openAction?.href).toBe('https://www.feishu.cn/docx/doc-123');
    expect(copyAction?.href).toBe(openAction?.href);
    expect(copyAction?.provider).toBe('feishu');
    expect(copyAction?.kind).toBe('copy-text');
  });

  it('keeps copy provider order stable when Notion and Feishu are both available', async () => {
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 4,
        source: 'chatgpt',
        conversationKey: 'conv-4',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
        notionWorkspaceSlug: 'chiimagnus',
        notionPageUrl: 'https://app.notion.com/p/chiimagnus/0123456789abcdef0123456789abcdef',
        feishuDocId: 'doc-456',
      },
      port: createPort(),
    });

    expect(bySlot(actions, 'open').map((action) => action.provider)).toEqual(['notion', 'feishu']);
    expect(bySlot(actions, 'copy').map((action) => action.provider)).toEqual(['notion', 'feishu']);
    expect(byId(actions, 'copy-notion-link')?.href).toBe(byId(actions, 'open-in-notion')?.href);
    expect(byId(actions, 'copy-feishu-link')?.href).toBe(byId(actions, 'open-in-feishu')?.href);
  });

  it('hydrates deep-link Notion and Feishu metadata with a single mapping read', async () => {
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation: {
        id: 5,
        source: 'chatgpt',
        conversationKey: 'conv-5',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      mapping: {
        notionPageId: NOTION_PAGE_ID,
        notionPageUrl: 'https://app.notion.com/p/chiimagnus/0123456789abcdef0123456789abcdef',
        notionWorkspaceSlug: 'chiimagnus',
        feishuDocId: 'doc-deep-link',
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 5,
        source: 'chatgpt',
        conversationKey: 'conv-5',
        title: 'Conversation',
      },
      port: createPort(),
    });

    expect(byId(actions, 'open-in-notion')?.href).toBe(
      'https://app.notion.com/p/chiimagnus/0123456789abcdef0123456789abcdef',
    );
    expect(byId(actions, 'copy-notion-link')?.href).toBe(byId(actions, 'open-in-notion')?.href);
    expect(byId(actions, 'open-in-feishu')?.href).toBe('https://www.feishu.cn/docx/doc-deep-link');
    expect(byId(actions, 'copy-feishu-link')?.href).toBe(byId(actions, 'open-in-feishu')?.href);
    expect(getSyncMappingByConversationMock).toHaveBeenCalledTimes(1);
    expect(getSyncMappingByConversationMock).toHaveBeenCalledWith(5);
  });

  it('recovers a valid hydrated Notion target when the conversation mirror has an invalid page id', async () => {
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation: { id: 6, notionPageId: NOTION_PAGE_ID },
      mapping: {
        notionPageId: NOTION_PAGE_ID,
        notionWorkspaceSlug: 'mapping-workspace',
        notionPageUrl: 'https://app.notion.com/p/mapping-workspace/0123456789abcdef0123456789abcdef',
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 6,
        source: 'chatgpt',
        conversationKey: 'conv-6',
        title: 'Conversation',
        notionPageId: 'not-a-valid-page-id',
        notionWorkspaceSlug: 'stale-workspace',
        notionPageUrl: 'https://app.notion.com/p/stale-workspace/not-a-valid-page-id',
      },
      port: createPort(),
    });

    expect(byId(actions, 'open-in-notion')?.href).toBe(
      'https://app.notion.com/p/mapping-workspace/0123456789abcdef0123456789abcdef',
    );
    expect(byId(actions, 'copy-notion-link')?.href).toBe(byId(actions, 'open-in-notion')?.href);
    expect(getSyncMappingByConversationMock).toHaveBeenCalledTimes(1);
  });

  it('does not hydrate unverifiable Notion URL metadata when the mapping has no valid page id', async () => {
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation: { id: 7, notionPageId: '' },
      mapping: {
        notionWorkspaceSlug: 'stale-workspace',
        notionPageUrl: 'https://app.notion.com/p/stale-workspace/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb',
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 7,
        source: 'chatgpt',
        conversationKey: 'conv-7',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      port: createPort(),
    });

    expect(byId(actions, 'open-in-notion')?.href).toBe('https://www.notion.so/0123456789abcdef0123456789abcdef');
    expect(byId(actions, 'copy-notion-link')?.href).toBe(byId(actions, 'open-in-notion')?.href);
  });

  it('preserves caller Notion metadata and never mixes metadata from a different hydrated target', async () => {
    getSyncMappingByConversationMock.mockResolvedValue({
      conversation: { id: 6, notionPageId: OTHER_NOTION_PAGE_ID },
      mapping: {
        notionPageId: OTHER_NOTION_PAGE_ID,
        notionWorkspaceSlug: 'mapping-workspace',
        notionPageUrl: 'https://app.notion.com/p/mapping-workspace/aaaaaaaabbbbccccddddeeeeeeeeeeee',
      },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 6,
        source: 'chatgpt',
        conversationKey: 'conv-6',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      port: createPort(),
    });

    expect(byId(actions, 'open-in-notion')?.href).toBe('https://www.notion.so/0123456789abcdef0123456789abcdef');
    expect(byId(actions, 'copy-notion-link')?.href).toBe(byId(actions, 'open-in-notion')?.href);
    expect(getSyncMappingByConversationMock).toHaveBeenCalledTimes(1);
  });

  it('resolves an Obsidian-only destination without producing a copy action', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValue(readyObsidian(7));

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 7,
        source: 'chatgpt',
        conversationKey: 'conv-7',
        title: 'Conversation',
      },
      port: createPort(),
    });

    expect(bySlot(actions, 'open')).toHaveLength(1);
    expect(bySlot(actions, 'open')[0]?.provider).toBe('obsidian');
    expect(bySlot(actions, 'copy')).toEqual([]);
  });

  it('resolves both Notion and Obsidian without treating Obsidian as copyable', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValue(readyObsidian(8));

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 8,
        source: 'chatgpt',
        conversationKey: 'conv-8',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      port: createPort(),
    });

    expect(bySlot(actions, 'open').map((action) => action.provider)).toEqual(['notion', 'obsidian']);
    expect(bySlot(actions, 'copy').map((action) => action.provider)).toEqual(['notion']);
  });

  it('keeps Notion open and copy actions when the Obsidian capability probe throws', async () => {
    resolveObsidianOpenTargetMock.mockRejectedValue(new Error('probe failed'));

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 9,
        source: 'chatgpt',
        conversationKey: 'conv-9',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      port: createPort(),
    });

    expect(bySlot(actions, 'open').map((action) => action.provider)).toEqual(['notion']);
    expect(bySlot(actions, 'copy').map((action) => action.provider)).toEqual(['notion']);
  });

  it('returns a disabled Obsidian API status action without a copy action', async () => {
    resolveObsidianOpenTargetMock.mockResolvedValue({
      available: false,
      label: 'Open in Obsidian',
      availabilityState: 'api-unavailable',
      error: { code: 'network_error', message: 'fetch failed' },
    });

    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 10,
        source: 'chatgpt',
        conversationKey: 'conv-10',
        title: 'Conversation',
      },
    });

    expect(bySlot(actions, 'open')).toHaveLength(1);
    expect(bySlot(actions, 'open')[0]?.provider).toBe('obsidian');
    expect(bySlot(actions, 'open')[0]?.label).toBe('Obsidian API not connected');
    expect(bySlot(actions, 'open')[0]?.disabled).toBe(true);
    expect(bySlot(actions, 'copy')).toEqual([]);
  });

  it('copies full Markdown only from detail matching the active conversation', async () => {
    const conversation = {
      id: 20,
      source: 'chatgpt',
      conversationKey: 'conv-20',
      title: 'Conversation',
      url: 'https://example.com/chat/20',
    };
    const detail = { conversationId: 20, messages: [{ role: 'user', contentText: 'hello' }] } as any;
    const actions = await resolveDetailHeaderActions({ conversation, detail, port: createPort() });
    const action = byId(actions, 'copy-full-markdown');

    expect(action?.disabled).toBe(false);
    await action?.onTrigger();
    expect(formatConversationMarkdownMock).toHaveBeenCalledTimes(1);
    expect(formatConversationMarkdownMock).toHaveBeenCalledWith(conversation, detail);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('# exact markdown\n');
  });

  it('disables full Markdown copying for missing or stale detail and never formats stale data', async () => {
    const conversation = {
      id: 21,
      source: 'chatgpt',
      conversationKey: 'conv-21',
      title: 'Conversation',
    };
    const missingActions = await resolveDetailHeaderActions({ conversation, detail: null, port: createPort() });
    const staleActions = await resolveDetailHeaderActions({
      conversation,
      detail: { conversationId: 999, messages: [{ role: 'user', contentText: 'stale' }] } as any,
      port: createPort(),
    });

    expect(byId(missingActions, 'copy-full-markdown')?.disabled).toBe(true);
    expect(byId(staleActions, 'copy-full-markdown')?.disabled).toBe(true);
    await expect(byId(staleActions, 'copy-full-markdown')?.onTrigger()).rejects.toThrow(t('copyFailed'));
    expect(formatConversationMarkdownMock).not.toHaveBeenCalled();
    expect(writeTextToClipboardMock).not.toHaveBeenCalled();
  });

  it('opens the exact trimmed original HTTP(S) URL without removing query or hash', async () => {
    const port = createPort();
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 22,
        source: 'chatgpt',
        conversationKey: 'conv-22',
        title: 'Conversation',
        url: '  https://example.com/path?x=1#section  ',
      },
      port,
    });
    const action = byId(actions, 'open-original');

    expect(action?.disabled).toBe(false);
    expect(action?.href).toBe('https://example.com/path?x=1#section');
    await action?.onTrigger();
    expect(port.openExternalUrl).toHaveBeenCalledWith('https://example.com/path?x=1#section');
  });

  it.each(['', 'javascript:alert(1)', 'obsidian://open?vault=x'])('disables Open original for %s', async (url) => {
    const port = createPort();
    const actions = await resolveDetailHeaderActions({
      conversation: { id: 23, source: 'chatgpt', conversationKey: 'conv-23', title: 'Conversation', url },
      port,
    });
    const action = byId(actions, 'open-original');

    expect(action?.disabled).toBe(true);
    expect(action?.href).toBeUndefined();
    await expect(action?.onTrigger()).rejects.toThrow(t('actionFailedFallback'));
    expect(port.openExternalUrl).not.toHaveBeenCalled();
  });

  it('propagates utility clipboard and open failures through the action error path', async () => {
    const port = createPort();
    port.openExternalUrl.mockResolvedValue(false);
    writeTextToClipboardMock.mockResolvedValue(false);
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 24,
        source: 'chatgpt',
        conversationKey: 'conv-24',
        title: 'Conversation',
        url: 'https://example.com/chat/24',
      },
      detail: { conversationId: 24, messages: [] } as any,
      port,
    });

    await expect(byId(actions, 'copy-full-markdown')?.onTrigger()).rejects.toThrow(t('copyFailed'));
    await expect(byId(actions, 'open-original')?.onTrigger()).rejects.toThrow(t('actionFailedFallback'));
  });

  it('rejects a copy trigger when clipboard write fails', async () => {
    writeTextToClipboardMock.mockResolvedValue(false);
    const actions = await resolveDetailHeaderActions({
      conversation: {
        id: 11,
        source: 'chatgpt',
        conversationKey: 'conv-11',
        title: 'Conversation',
        notionPageId: NOTION_PAGE_ID,
      },
      port: createPort(),
    });

    await expect(byId(actions, 'copy-notion-link')?.onTrigger()).rejects.toThrow(t('copyFailed'));
    expect(writeTextToClipboardMock).toHaveBeenCalledWith(byId(actions, 'open-in-notion')?.href);
  });
});
