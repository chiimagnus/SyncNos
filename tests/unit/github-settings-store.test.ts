import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Record<string, unknown>;

vi.mock('@platform/storage/local', () => ({
  storageGet: async (keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
    }
    return out;
  },
  storageSet: async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  },
}));

describe('github settings store', () => {
  beforeEach(() => {
    store = {};
    vi.resetModules();
  });

  it('ships only public GitHub App metadata', async () => {
    const { GITHUB_APP_CONFIG } = await import('@services/sync/github/github-app-config');
    expect(GITHUB_APP_CONFIG).toEqual({
      clientId: 'Iv23li7lctsW4U5YthUV',
      appSlug: 'syncnos',
      deviceCodeUrl: 'https://github.com/login/device/code',
      accessTokenUrl: 'https://github.com/login/oauth/access_token',
      deviceVerificationUrl: 'https://github.com/login/device',
      apiBaseUrl: 'https://api.github.com',
      appUrl: 'https://github.com/apps/syncnos',
      installUrl: 'https://github.com/apps/syncnos/installations/new',
    });
    expect(JSON.stringify(GITHUB_APP_CONFIG).toLowerCase()).not.toContain('secret');
    expect(JSON.stringify(GITHUB_APP_CONFIG).toLowerCase()).not.toContain('private');
  });

  it('normalizes repository and encodes owner/repo as separate URL segments', async () => {
    const { encodeGithubRepositoryPath, normalizeGithubRepository } =
      await import('@services/sync/github/settings-store');
    expect(normalizeGithubRepository(' chiimagnus / SyncNos-Webclipper ')).toBe('chiimagnus/SyncNos-Webclipper');
    expect(encodeGithubRepositoryPath('chiimagnus/SyncNos-Webclipper')).toBe('chiimagnus/SyncNos-Webclipper');

    for (const invalid of [
      '',
      'owner',
      'owner/repo/extra',
      './repo',
      'owner/..',
      'owner\\repo',
      'owner/re po',
      'owner/repo\u0000',
    ]) {
      if (invalid === '') {
        expect(normalizeGithubRepository(invalid)).toBe('');
      } else {
        expect(() => normalizeGithubRepository(invalid)).toThrow('github_settings_invalid:repository');
      }
    }
  });

  it('accepts nested branches and URL-encodes each ref segment', async () => {
    const { encodeGithubBranchPath, normalizeGithubBranch } = await import('@services/sync/github/settings-store');
    expect(normalizeGithubBranch('main')).toBe('main');
    expect(normalizeGithubBranch('feature/foo')).toBe('feature/foo');
    expect(encodeGithubBranchPath('feature/百分比%')).toBe('feature/%E7%99%BE%E5%88%86%E6%AF%94%25');
    expect(normalizeGithubBranch('')).toBe('');

    for (const invalid of [
      '/main',
      'main/',
      'feature//foo',
      'feature/../foo',
      ' feature/foo',
      'feature/foo ',
      '.hidden',
      'foo/.bar',
      'foo.lock',
      'foo\\bar',
      'foo bar',
      'foo~bar',
      'foo@{bar',
      '@',
    ]) {
      expect(() => normalizeGithubBranch(invalid)).toThrow('github_settings_invalid:branch');
    }
  });

  it('uses fixed output folders outside the persisted settings model', async () => {
    const { GITHUB_OUTPUT_FOLDERS, getGithubSettings } = await import('@services/sync/github/settings-store');
    expect(GITHUB_OUTPUT_FOLDERS).toEqual({
      chat: 'AIChats',
      article: 'WebArticles',
      video: 'VideosScripts',
    });
    await expect(getGithubSettings()).resolves.toEqual({
      repository: '',
      branch: '',
      defaults: { repository: '', branch: '' },
    });
  });

  it('persists only normalized repository and branch settings', async () => {
    const { GITHUB_STORAGE_KEYS, getGithubSettings, saveGithubSettings } =
      await import('@services/sync/github/settings-store');
    const defaults = await getGithubSettings();
    expect(defaults).toEqual({
      repository: '',
      branch: '',
      defaults: { repository: '', branch: '' },
    });

    const saved = await saveGithubSettings({
      repository: ' chiimagnus / SyncNos-Webclipper ',
      branch: 'feature/github-sync',
    });
    expect(saved).toEqual({
      repository: 'chiimagnus/SyncNos-Webclipper',
      branch: 'feature/github-sync',
      defaults: { repository: '', branch: '' },
    });
    expect(Object.keys(store).sort()).toEqual(Object.values(GITHUB_STORAGE_KEYS).sort());
  });

  it('fails closed when persisted settings are corrupted', async () => {
    const { GITHUB_STORAGE_KEYS, getGithubSettings } = await import('@services/sync/github/settings-store');
    store[GITHUB_STORAGE_KEYS.branch] = '../main';
    await expect(getGithubSettings()).rejects.toThrow('github_settings_invalid:branch');
  });
});
