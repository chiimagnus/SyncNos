import { describe, expect, it, vi } from 'vitest';

import { OBSIDIAN_APP_LAUNCH_URL } from '../../src/sync/obsidian/obsidian-app-launch';
import {
  openObsidianTarget,
  resolveObsidianOpenTarget,
} from '../../src/ui/conversations/detail-header-obsidian-target';

describe('detail-header-obsidian-target', () => {
  it('surfaces a launch-before-retry trigger when the local API is unreachable', async () => {
    const target = await resolveObsidianOpenTarget({
      conversation: {
        id: 1,
        source: 'chatgpt',
        conversationKey: 'conv-1',
        title: 'Conversation',
      },
      services: {
        settingsStore: {
          getConnectionConfig: vi.fn(async () => ({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k', authHeaderName: 'Authorization' })),
          getPathConfig: vi.fn(async () => ({ chatFolder: 'SyncNos-AIChats', articleFolder: 'SyncNos-WebArticles' })),
        },
        localRestClient: {
          NOTE_JSON_ACCEPT: 'application/vnd.olrapi.note+json',
          createClient: vi.fn(() => ({ ok: true, openVaultFile: vi.fn(async () => ({ ok: true })) })),
        },
        notePath: {
          buildStableNotePath: vi.fn(() => 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md'),
          resolveExistingNotePath: vi.fn(async () => ({
            ok: false,
            desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
            error: { code: 'network_error', message: 'fetch failed' },
          })),
        },
        metadata: {
          readSyncnosObject: vi.fn(),
        },
      },
    });

    expect(target.available).toBe(true);
    expect(target.trigger?.launchBeforeRetry).toBe(true);
  });

  it('launches the app URI and then opens the resolved note through the local REST API', async () => {
    const openVaultFile = vi.fn(async () => ({ ok: true }));
    const resolveExistingNotePath = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        error: { code: 'network_error', message: 'fetch failed' },
      })
      .mockResolvedValueOnce({
        ok: true,
        desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        resolvedFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        found: true,
      });

    const services = {
      settingsStore: {
        getConnectionConfig: vi.fn(async () => ({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k', authHeaderName: 'Authorization' })),
        getPathConfig: vi.fn(async () => ({ chatFolder: 'SyncNos-AIChats', articleFolder: 'SyncNos-WebArticles' })),
      },
      localRestClient: {
        NOTE_JSON_ACCEPT: 'application/vnd.olrapi.note+json',
        createClient: vi.fn(() => ({ ok: true, openVaultFile })),
      },
      notePath: {
        buildStableNotePath: vi.fn(() => 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md'),
        resolveExistingNotePath,
      },
      metadata: {
        readSyncnosObject: vi.fn(),
      },
    };

    const target = await resolveObsidianOpenTarget({
      conversation: {
        id: 2,
        source: 'chatgpt',
        conversationKey: 'conv-2',
        title: 'Conversation',
      },
      services,
    });
    expect(target.available).toBe(true);
    expect(target.trigger?.launchBeforeRetry).toBe(true);

    const launchProtocolUrl = vi.fn(async () => true);
    const wait = vi.fn(async () => {});
    const reportError = vi.fn();

    const result = await openObsidianTarget({
      trigger: target.trigger!,
      services,
      port: {
        launchProtocolUrl,
        wait,
        reportError,
      },
    });

    expect(result.ok).toBe(true);
    expect(launchProtocolUrl).toHaveBeenCalledWith(OBSIDIAN_APP_LAUNCH_URL);
    expect(openVaultFile).toHaveBeenCalledWith('SyncNos-AIChats/chatgpt-Conversation-1234567890.md');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('re-resolves the note path across retries until the app is ready', async () => {
    const openVaultFile = vi.fn(async () => ({ ok: true }));
    const resolveExistingNotePath = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        error: { code: 'network_error', message: 'fetch failed' },
      })
      .mockResolvedValueOnce({
        ok: false,
        desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        error: { code: 'network_error', message: 'still starting' },
      })
      .mockResolvedValueOnce({
        ok: true,
        desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
        resolvedFilePath: 'SyncNos-AIChats/chatgpt-Old-1234567890.md',
        found: true,
      });

    const services = {
      settingsStore: {
        getConnectionConfig: vi.fn(async () => ({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k', authHeaderName: 'Authorization' })),
        getPathConfig: vi.fn(async () => ({ chatFolder: 'SyncNos-AIChats', articleFolder: 'SyncNos-WebArticles' })),
      },
      localRestClient: {
        NOTE_JSON_ACCEPT: 'application/vnd.olrapi.note+json',
        createClient: vi.fn(() => ({ ok: true, openVaultFile })),
      },
      notePath: {
        buildStableNotePath: vi.fn(() => 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md'),
        resolveExistingNotePath,
      },
      metadata: {
        readSyncnosObject: vi.fn(),
      },
    };

    const target = await resolveObsidianOpenTarget({
      conversation: {
        id: 3,
        source: 'chatgpt',
        conversationKey: 'conv-3',
        title: 'Conversation',
      },
      services,
    });
    expect(target.available).toBe(true);

    const launchProtocolUrl = vi.fn(async () => true);
    const wait = vi.fn(async () => {});
    const reportError = vi.fn();

    const result = await openObsidianTarget({
      trigger: target.trigger!,
      services,
      port: {
        launchProtocolUrl,
        wait,
        reportError,
      },
    });

    expect(result.ok).toBe(true);
    expect(resolveExistingNotePath).toHaveBeenCalledTimes(3);
    expect(openVaultFile).toHaveBeenCalledWith('SyncNos-AIChats/chatgpt-Old-1234567890.md');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('launches the app and retries when openVaultFile hits a local network error after path resolution', async () => {
    const openVaultFile = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network_error', message: 'fetch failed' } })
      .mockResolvedValueOnce({ ok: true });

    const services = {
      settingsStore: {
        getConnectionConfig: vi.fn(async () => ({ apiBaseUrl: 'http://127.0.0.1:27123', apiKey: 'k', authHeaderName: 'Authorization' })),
        getPathConfig: vi.fn(async () => ({ chatFolder: 'SyncNos-AIChats', articleFolder: 'SyncNos-WebArticles' })),
      },
      localRestClient: {
        NOTE_JSON_ACCEPT: 'application/vnd.olrapi.note+json',
        createClient: vi.fn(() => ({ ok: true, openVaultFile })),
      },
      notePath: {
        buildStableNotePath: vi.fn(() => 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md'),
        resolveExistingNotePath: vi.fn(async () => ({
          ok: true,
          desiredFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
          resolvedFilePath: 'SyncNos-AIChats/chatgpt-Conversation-1234567890.md',
          found: true,
        })),
      },
      metadata: {
        readSyncnosObject: vi.fn(),
      },
    };

    const launchProtocolUrl = vi.fn(async () => true);
    const wait = vi.fn(async () => {});
    const reportError = vi.fn();

    const result = await openObsidianTarget({
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
      services,
      port: {
        launchProtocolUrl,
        wait,
        reportError,
      },
    });

    expect(result.ok).toBe(true);
    expect(launchProtocolUrl).toHaveBeenCalledWith(OBSIDIAN_APP_LAUNCH_URL);
    expect(openVaultFile).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });
});
