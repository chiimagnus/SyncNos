import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversationSyncMapping: vi.fn(),
  isSyncProviderEnabled: vi.fn(),
  resolveObsidianOpenTarget: vi.fn(),
}));

vi.mock('@services/conversations/client/repo', () => ({
  getConversationSyncMapping: mocks.getConversationSyncMapping,
}));
vi.mock('@services/sync/sync-provider-gate', () => ({
  isSyncProviderEnabled: mocks.isSyncProviderEnabled,
}));
vi.mock('@services/integrations/openin/obsidian-open-target', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, resolveObsidianOpenTarget: mocks.resolveObsidianOpenTarget };
});

import { resolveOpenInDetailHeaderActions } from '@services/integrations/openin/openin-detail-header-actions';

const port = {
  openExternalUrl: vi.fn(async () => true),
  launchProtocolUrl: vi.fn(async () => true),
  wait: vi.fn(async () => {}),
  reportError: vi.fn(),
};

describe('OpenIn local-data routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSyncProviderEnabled.mockImplementation(async (provider: string) => provider === 'notion');
    mocks.resolveObsidianOpenTarget.mockResolvedValue({ available: false, availabilityState: 'not-synced' });
    mocks.getConversationSyncMapping.mockResolvedValue({
      notionPageUrl: 'https://www.notion.so/workspace/page-abc',
      notionWorkspaceSlug: 'workspace',
    });
  });

  it('looks up provider metadata only with a detail-issued stable reference and facts epoch', async () => {
    await resolveOpenInDetailHeaderActions({
      conversation: {
        id: 991,
        source: 'chatgpt',
        conversationKey: 'thread-stable',
        factsEpoch: 'native:epoch-2' as any,
        notionPageId: 'page-abc',
      },
      port,
    });

    expect(mocks.getConversationSyncMapping).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationSyncMapping).toHaveBeenCalledWith({
      source: 'chatgpt',
      conversationKey: 'thread-stable',
      factsEpoch: 'native:epoch-2',
    });
    expect(JSON.stringify(mocks.getConversationSyncMapping.mock.calls[0][0])).not.toContain('991');
  });

  it('does not fall back to a numeric ID when the caller has no facts epoch', async () => {
    await resolveOpenInDetailHeaderActions({
      conversation: {
        id: 991,
        source: 'chatgpt',
        conversationKey: 'thread-stable',
        notionPageId: 'page-abc',
      },
      port,
    });

    expect(mocks.getConversationSyncMapping).not.toHaveBeenCalled();
  });
});
