import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, unknown>;
let writes: unknown[];
let blockNextSet: boolean;
let releaseBlockedSet: (() => void) | null;
let setStarted: Promise<void> | null;
let resolveSetStarted: (() => void) | null;

vi.mock('@platform/storage/local', () => ({
  storageGet: async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
    }
    return out;
  },
  storageSet: async (items: Record<string, unknown>) => {
    writes.push(structuredClone(items));
    resolveSetStarted?.();
    if (blockNextSet) {
      blockNextSet = false;
      await new Promise<void>((resolve) => {
        releaseBlockedSet = resolve;
      });
    }
    Object.assign(store, structuredClone(items));
  },
}));

function pendingState(deviceCode = 'device-secret') {
  return {
    version: 1 as const,
    state: 'pending' as const,
    pending: {
      deviceCode,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      createdAt: 1_000,
      expiresAt: 901_000,
      intervalMs: 5_000,
      nextPollAt: 6_000,
    },
  };
}

function connectedState(accessToken = 'access-secret', refreshToken = 'refresh-secret') {
  return {
    version: 1 as const,
    state: 'connected' as const,
    token: {
      accessToken,
      accessExpiresAt: 28_801_000,
      refreshToken,
      refreshExpiresAt: 15_552_001_000,
      createdAt: 1_000,
    },
  };
}

describe('github auth store', () => {
  beforeEach(() => {
    store = {};
    writes = [];
    blockNextSet = false;
    releaseBlockedSet = null;
    setStarted = null;
    resolveSetStarted = null;
    vi.resetModules();
  });

  it('uses one versioned auth-state key for pending, connected rotation and clear', async () => {
    const mod = await import('@services/sync/github/auth/auth-store');
    await mod.replaceGithubAuthState(pendingState());
    await mod.replaceGithubAuthState(connectedState());
    await mod.replaceGithubAuthState(connectedState('access-rotated', 'refresh-rotated'));
    await mod.clearGithubAuthState();

    expect(Object.keys(store)).toEqual([mod.GITHUB_AUTH_STATE_KEY]);
    expect(writes).toHaveLength(4);
    expect(writes.every((write: any) => Object.keys(write).length === 1 && mod.GITHUB_AUTH_STATE_KEY in write)).toBe(
      true,
    );
    expect(store[mod.GITHUB_AUTH_STATE_KEY]).toEqual({ version: 1, state: 'disconnected' });
  });

  it('safe summaries never expose access, refresh or device secrets', async () => {
    const mod = await import('@services/sync/github/auth/auth-store');
    await mod.replaceGithubAuthState(pendingState('DEVICE_SENTINEL_SECRET'));
    const pendingSummary = await mod.getGithubSafeAuthSummary();
    expect(pendingSummary).toEqual({
      state: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 901_000,
      nextPollAt: 6_000,
    });
    expect(JSON.stringify(pendingSummary)).not.toContain('DEVICE_SENTINEL_SECRET');

    await mod.replaceGithubAuthState(connectedState('ACCESS_SENTINEL_SECRET', 'REFRESH_SENTINEL_SECRET'));
    const connectedSummary = await mod.getGithubSafeAuthSummary();
    expect(connectedSummary).toEqual({ state: 'connected' });
    expect(JSON.stringify(connectedSummary)).not.toMatch(/ACCESS_SENTINEL_SECRET|REFRESH_SENTINEL_SECRET/);
  });

  it('fails closed on malformed persisted auth state without echoing secrets', async () => {
    const mod = await import('@services/sync/github/auth/auth-store');
    store[mod.GITHUB_AUTH_STATE_KEY] = {
      version: 1,
      state: 'connected',
      token: { accessToken: 'ACCESS_SENTINEL_SECRET', createdAt: 'bad' },
    };
    expect(await mod.getGithubAuthState()).toEqual({ version: 1, state: 'disconnected' });

    await expect(mod.replaceGithubAuthState(connectedState(' bad-token ') as any)).rejects.toThrow(
      'github_auth_state_invalid',
    );
  });

  it('serializes concurrent read-modify-write transitions through the mutation queue', async () => {
    const mod = await import('@services/sync/github/auth/auth-store');
    await mod.replaceGithubAuthState(pendingState());

    setStarted = new Promise<void>((resolve) => {
      resolveSetStarted = resolve;
    });
    blockNextSet = true;
    const first = mod.updateGithubAuthState(async (current) => {
      expect(current.state).toBe('pending');
      return connectedState('access-first', 'refresh-first');
    });
    await setStarted;

    let secondSaw: string | null = null;
    const second = mod.updateGithubAuthState(async (current) => {
      secondSaw = current.state === 'connected' ? current.token.accessToken : current.state;
      return { version: 1, state: 'disconnected' };
    });

    await Promise.resolve();
    expect(secondSaw).toBe(null);
    expect(releaseBlockedSet).toBeTypeOf('function');
    releaseBlockedSet?.();
    await first;
    await second;

    expect(secondSaw).toBe('access-first');
    expect(store[mod.GITHUB_AUTH_STATE_KEY]).toEqual({ version: 1, state: 'disconnected' });
  });
});
