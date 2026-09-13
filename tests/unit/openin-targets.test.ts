import { describe, expect, it, vi } from 'vitest';

import {
  OpenTargetError,
  launchOpenTarget,
  launchOpenTargetByConversationId,
  resolveOpenTargets,
  resolveOpenTargetsByConversationId,
  resolveSourceOpenTarget,
} from '@services/integrations/openin/openin-targets';
import { buildConversationBasename } from '@services/conversations/domain/file-naming';

const NOTION_A = '0123456789abcdef0123456789abcdef';
const NOTION_B = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    source: 'chatgpt',
    sourceType: 'chat',
    conversationKey: 'conv-7',
    title: 'Conversation',
    url: 'https://example.com/chat/7',
    ...overrides,
  } as any;
}

function readyObsidian(input = conversation()) {
  return {
    available: true,
    label: 'Open in Obsidian',
    availabilityState: 'ready',
    trigger: {
      provider: 'obsidian',
      openMode: 'rest-api',
      conversation: input,
      resolvedNotePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
      launchBeforeRetry: false,
      retryPolicy: { maxAttempts: 3, launchDelayMs: 1200, retryDelayMs: 750 },
    },
  } as const;
}

function githubContinuity(input = conversation()) {
  const markdownPath = `AIChats/${buildConversationBasename(input)}.md`;
  return {
    githubRemoteKey: 'github.com/octocat/sync-notes@feature/open-in',
    githubLastSyncedAt: 1_725_000_000_000,
    githubManagedFiles: {
      [markdownPath]: {
        kind: 'markdown',
        contentHash: 'a'.repeat(64),
        sha: 'b'.repeat(40),
      },
    },
  };
}

function createServices(overrides: Record<string, unknown> = {}) {
  const baseConversation = conversation();
  return {
    getConversationById: vi.fn(async () => baseConversation),
    getSyncMappingByConversation: vi.fn(async () => ({ conversation: baseConversation, mapping: null })),
    isSyncProviderEnabled: vi.fn(async () => true),
    resolveObsidianOpenTarget: vi.fn(async ({ conversation: input }: any) => readyObsidian(input)),
    openObsidianTarget: vi.fn(async () => ({ ok: true })),
    obsidianServices: {},
    openExternalUrl: vi.fn(async () => true),
    ...overrides,
  } as any;
}

describe('open-in machine targets', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://example.com/a', true],
    ['javascript:alert(1)', false],
    ['data:text/plain,hello', false],
    ['https://exa mple.com', false],
    ['', false],
  ])('validates source target %s without creating an arbitrary launcher', (url, available) => {
    const result = resolveSourceOpenTarget(conversation({ url }));
    expect(result.provider).toBe('source');
    expect(result.available).toBe(available);
    expect(result.kind).toBe('external-url');
    expect(result.availabilityState).toBe(available ? 'ready' : 'invalid_source');
    if (available) expect(result.target).toBe(url);
    else expect(result.target).toBeUndefined();
  });

  it('resolves all five machine targets with one shared fresh mapping read and no UI closures/internal Obsidian trigger', async () => {
    const input = conversation({
      notionPageId: NOTION_A,
      notionWorkspaceSlug: 'workspace',
      feishuDocId: 'mirror-doc',
    });
    const mapping = {
      notionPageId: NOTION_A,
      feishuDocId: 'fresh-doc',
      ...githubContinuity(input),
      secretSentinel: 'MUST_NOT_LEAK',
    };
    const services = createServices({
      getSyncMappingByConversation: vi.fn(async () => ({ conversation: input, mapping })),
    });

    const targets = await resolveOpenTargets({ conversation: input, services });
    expect(targets.map((target) => target.provider)).toEqual(['source', 'notion', 'obsidian', 'feishu', 'github']);
    expect(services.getSyncMappingByConversation).toHaveBeenCalledTimes(1);
    expect(targets.find((target) => target.provider === 'notion')).toMatchObject({
      available: true,
      target: `https://app.notion.com/p/workspace/${NOTION_A}`,
    });
    expect(targets.find((target) => target.provider === 'feishu')).toMatchObject({
      available: true,
      target: 'https://www.feishu.cn/docx/fresh-doc',
    });
    expect(targets.find((target) => target.provider === 'github')?.target).toContain(
      'https://github.com/octocat/sync-notes/blob/feature/open-in/',
    );
    expect(targets.find((target) => target.provider === 'obsidian')).toEqual({
      provider: 'obsidian',
      available: true,
      kind: 'obsidian-note',
      target: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
      availabilityState: 'ready',
    });
    const json = JSON.stringify(targets);
    expect(json).not.toContain('MUST_NOT_LEAK');
    expect(json).not.toContain('retryPolicy');
    expect(json).not.toContain('conversationKey');
    expect(json).not.toContain('onTrigger');
  });

  it('uses the fresh Notion mapping id and refuses stale mirror URL/slug metadata from a different page id', async () => {
    const input = conversation({
      notionPageId: NOTION_A,
      notionPageUrl: `https://www.notion.so/stale-workspace/Stale-${NOTION_A}`,
      notionWorkspaceSlug: 'stale-workspace',
    });
    const freshConversation = {
      ...input,
      notionPageId: NOTION_A,
      notionPageUrl: `https://www.notion.so/stale-workspace/Stale-${NOTION_A}`,
      notionWorkspaceSlug: 'stale-workspace',
    };
    const services = createServices({
      getSyncMappingByConversation: vi.fn(async () => ({
        conversation: freshConversation,
        mapping: { notionPageId: NOTION_B },
      })),
    });

    const [target] = await resolveOpenTargets({ conversation: input, targets: ['notion'], services });
    expect(target).toEqual({
      provider: 'notion',
      available: true,
      kind: 'external-url',
      target: `https://www.notion.so/${NOTION_B}`,
      availabilityState: 'ready',
    });
  });

  it('uses Feishu mapping field presence as authoritative, including an explicit empty value', async () => {
    const input = conversation({ feishuDocId: 'stale-mirror' });
    const services = createServices({
      getSyncMappingByConversation: vi
        .fn()
        .mockResolvedValueOnce({
          conversation: { ...input, feishuDocId: 'fresh-mirror' },
          mapping: { feishuDocId: '' },
        })
        .mockResolvedValueOnce({ conversation: { ...input, feishuDocId: 'fresh-mirror' }, mapping: {} }),
    });

    const [explicitEmpty] = await resolveOpenTargets({ conversation: input, targets: ['feishu'], services });
    expect(explicitEmpty).toMatchObject({ available: false, availabilityState: 'not_synced' });
    const [fallbackMirror] = await resolveOpenTargets({ conversation: input, targets: ['feishu'], services });
    expect(fallbackMirror).toMatchObject({
      available: true,
      target: 'https://www.feishu.cn/docx/fresh-mirror',
    });
  });

  it('propagates fresh mapping read failures instead of falling back to stale conversation metadata', async () => {
    const services = createServices({
      getSyncMappingByConversation: vi.fn(async () => {
        throw new Error('mapping read failed');
      }),
    });
    await expect(resolveOpenTargets({ conversation: conversation(), targets: ['github'], services })).rejects.toThrow(
      'mapping read failed',
    );
  });

  it('propagates provider-gate read failures instead of treating the provider as enabled', async () => {
    const services = createServices({
      isSyncProviderEnabled: vi.fn(async () => {
        throw new Error('provider gate unavailable');
      }),
    });
    await expect(resolveOpenTargets({ conversation: conversation(), targets: ['github'], services })).rejects.toThrow(
      'provider gate unavailable',
    );
    expect(services.getSyncMappingByConversation).not.toHaveBeenCalled();
  });

  it('returns provider_disabled without mapping/provider REST probes', async () => {
    const services = createServices({
      isSyncProviderEnabled: vi.fn(async (provider: string) => provider !== 'obsidian'),
      resolveObsidianOpenTarget: vi.fn(async () => {
        throw new Error('must not probe');
      }),
    });
    const [target] = await resolveOpenTargets({ conversation: conversation(), targets: ['obsidian'], services });
    expect(target).toEqual({
      provider: 'obsidian',
      available: false,
      kind: 'obsidian-note',
      availabilityState: 'provider_disabled',
      error: { code: 'provider_disabled', message: 'obsidian sync provider is disabled.' },
    });
    expect(services.resolveObsidianOpenTarget).not.toHaveBeenCalled();
    expect(services.getSyncMappingByConversation).not.toHaveBeenCalled();
  });

  it('degrades an Obsidian probe exception to api_unavailable without exposing the exception text', async () => {
    const services = createServices({
      resolveObsidianOpenTarget: vi.fn(async () => {
        throw new Error('SECRET_INTERNAL_ERROR');
      }),
    });
    const [target] = await resolveOpenTargets({ conversation: conversation(), targets: ['obsidian'], services });
    expect(target).toEqual({
      provider: 'obsidian',
      available: false,
      kind: 'obsidian-note',
      availabilityState: 'api_unavailable',
      error: { code: 'obsidian_probe_failed', message: 'Obsidian target is unavailable.' },
    });
    expect(JSON.stringify(target)).not.toContain('SECRET_INTERNAL_ERROR');
  });

  it('loads a fresh conversation by id and fails closed before storage reads for invalid ids/providers', async () => {
    const services = createServices({ getConversationById: vi.fn(async () => null) });
    await expect(resolveOpenTargetsByConversationId({ conversationId: 0, services })).rejects.toMatchObject({
      code: 'invalid_conversation_id',
    });
    await expect(
      resolveOpenTargetsByConversationId({ conversationId: 7, target: 'javascript:bad', services }),
    ).rejects.toMatchObject({ code: 'open_target_invalid_provider' });
    expect(services.getConversationById).not.toHaveBeenCalled();

    const missingServices = createServices({ getConversationById: vi.fn(async () => null) });
    await expect(
      resolveOpenTargetsByConversationId({ conversationId: 7, target: 'source', services: missingServices }),
    ).rejects.toMatchObject({ code: 'conversation_not_found', extra: { conversationId: 7 } });
    expect(missingServices.getConversationById).toHaveBeenCalledWith(7);
  });

  it('re-resolves the current source target immediately before launch and never accepts a caller URL', async () => {
    const initial = conversation({ url: 'https://old.example/item' });
    const current = conversation({ url: 'https://new.example/item' });
    const services = createServices({
      getConversationById: vi.fn(async () => current),
      openExternalUrl: vi.fn(async () => true),
    });

    const preview = resolveSourceOpenTarget(initial);
    expect(preview.target).toBe('https://old.example/item');
    const launched = await launchOpenTargetByConversationId({ conversationId: 7, target: 'source', services });
    expect(launched).toMatchObject({ ok: true, target: { target: 'https://new.example/item' } });
    expect(services.openExternalUrl).toHaveBeenCalledWith('https://new.example/item');
    expect(services.openExternalUrl).not.toHaveBeenCalledWith('https://old.example/item');
  });

  it('does not probe or launch Obsidian when the provider is disabled', async () => {
    const services = createServices({
      isSyncProviderEnabled: vi.fn(async (provider: string) => provider !== 'obsidian'),
      resolveObsidianOpenTarget: vi.fn(async () => {
        throw new Error('must not probe');
      }),
      openObsidianTarget: vi.fn(async () => ({ ok: true })),
    });

    const result = await launchOpenTarget({ conversation: conversation(), target: 'obsidian', services });
    expect(result).toMatchObject({
      ok: false,
      target: { provider: 'obsidian', availabilityState: 'provider_disabled' },
      error: { code: 'provider_disabled' },
    });
    expect(services.resolveObsidianOpenTarget).not.toHaveBeenCalled();
    expect(services.openObsidianTarget).not.toHaveBeenCalled();
  });

  it('uses one fresh Obsidian probe for launch and passes only that internal trigger to the canonical action', async () => {
    const input = conversation();
    const fresh = {
      ...readyObsidian(input),
      trigger: { ...readyObsidian(input).trigger, resolvedNotePath: 'SyncNos-AIChats/fresh.md' },
    };
    const services = createServices({
      resolveObsidianOpenTarget: vi.fn().mockResolvedValue(fresh),
      openObsidianTarget: vi.fn(async () => ({ ok: true })),
    });

    const result = await launchOpenTarget({ conversation: input, target: 'obsidian', services });
    expect(result).toMatchObject({
      ok: true,
      target: { provider: 'obsidian', target: 'SyncNos-AIChats/fresh.md' },
    });
    expect(services.resolveObsidianOpenTarget).toHaveBeenCalledTimes(1);
    expect(services.openObsidianTarget).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: expect.objectContaining({ resolvedNotePath: 'SyncNos-AIChats/fresh.md' }) }),
    );
  });

  it('uses only fresh current GitHub conversation ownership with its continuity mapping', async () => {
    const input = conversation({ title: 'Stale UI title' });
    const freshConversation = conversation({ title: 'Fresh stored title' });
    const services = createServices({
      getSyncMappingByConversation: vi.fn(async () => ({
        conversation: freshConversation,
        mapping: githubContinuity(freshConversation),
      })),
    });
    const [ready] = await resolveOpenTargets({ conversation: input, targets: ['github'], services });
    expect(ready.available).toBe(true);
    expect(ready.target).toContain(
      encodeURIComponent(buildConversationBasename(freshConversation)).replace(/%2F/g, '/'),
    );

    const staleServices = createServices({
      getSyncMappingByConversation: vi.fn(async () => ({
        conversation: freshConversation,
        mapping: {
          ...githubContinuity(freshConversation),
          githubManagedFiles: {
            'AIChats/not-owned.md': { kind: 'markdown', contentHash: 'a'.repeat(64), sha: 'b'.repeat(40) },
          },
        },
      })),
    });
    const [stale] = await resolveOpenTargets({ conversation: input, targets: ['github'], services: staleServices });
    expect(stale).toMatchObject({ available: false, availabilityState: 'not_synced' });
  });

  it('uses a structured OpenTargetError without leaking arbitrary target values', () => {
    const error = new OpenTargetError('open_target_invalid_provider', 'Invalid open target provider');
    expect(error).toMatchObject({ code: 'open_target_invalid_provider', extra: null });
  });
});
