import { describe, expect, it, vi } from 'vitest';

import { primeObsidianAppForSync } from '../../src/ui/conversations/obsidian-sync-launch';

describe('obsidian-sync-launch', () => {
  it('waits for app startup when the local REST API probe returns network_error', async () => {
    const launchProtocolUrl = vi.fn(async () => true);
    const wait = vi.fn(async () => {});

    const result = await primeObsidianAppForSync({
      services: {
        settingsStore: {
          getConnectionConfig: vi.fn(async () => ({
            apiBaseUrl: 'http://127.0.0.1:27123',
            apiKey: 'k',
            authHeaderName: 'Authorization',
          })),
        },
        localRestClient: {
          createClient: vi.fn(() => ({
            ok: true,
            getServerStatus: vi.fn(async () => ({
              ok: false,
              error: { code: 'network_error', message: 'fetch failed' },
            })),
          })),
        },
      },
      port: {
        launchProtocolUrl,
        wait,
      },
    });

    expect(result).toEqual({
      launched: true,
      waited: true,
      reason: 'launch_and_wait',
    });
    expect(launchProtocolUrl).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('skips the startup wait when the local REST API is already reachable', async () => {
    const launchProtocolUrl = vi.fn(async () => true);
    const wait = vi.fn(async () => {});

    const result = await primeObsidianAppForSync({
      services: {
        settingsStore: {
          getConnectionConfig: vi.fn(async () => ({
            apiBaseUrl: 'http://127.0.0.1:27123',
            apiKey: 'k',
            authHeaderName: 'Authorization',
          })),
        },
        localRestClient: {
          createClient: vi.fn(() => ({
            ok: true,
            getServerStatus: vi.fn(async () => ({ ok: true, data: { ok: true } })),
          })),
        },
      },
      port: {
        launchProtocolUrl,
        wait,
      },
    });

    expect(result).toEqual({
      launched: false,
      waited: false,
      reason: 'already_reachable',
    });
    expect(launchProtocolUrl).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
