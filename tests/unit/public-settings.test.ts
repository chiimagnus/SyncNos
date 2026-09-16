import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  inpageMode: 'all' as 'supported' | 'all' | 'off',
  providerEnabled: new Map<string, boolean>(),
  autoSyncEnabled: new Map<string, boolean>(),
  antiHotlinkRules: [{ domain: 'example.com', referer: 'https://example.com/' }] as Array<{
    domain: string;
    referer: string;
  }>,
}));

vi.mock('@services/shared/storage', () => ({
  storageGet: async (keys: string[]) => Object.fromEntries((keys || []).map((key) => [key, state.storage[key]])),
  storageSet: async (patch: Record<string, unknown>) => {
    Object.assign(state.storage, patch || {});
  },
}));

vi.mock('@services/shared/inpage-display-mode', () => ({
  normalizeInpageDisplayMode: (value: unknown) => {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    return raw === 'supported' || raw === 'all' || raw === 'off' ? raw : null;
  },
  readEffectiveInpageDisplayMode: async () => state.inpageMode,
  setCanonicalInpageDisplayMode: async (value: unknown) => {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw !== 'supported' && raw !== 'all' && raw !== 'off') throw new Error('invalid inpage display mode');
    state.inpageMode = raw;
    return raw;
  },
}));

vi.mock('@services/sync/sync-provider-gate', () => ({
  isSyncProviderEnabled: async (provider: string) => state.providerEnabled.get(provider) ?? true,
  setSyncProviderEnabled: async (provider: string, enabled: boolean) => {
    state.providerEnabled.set(provider, enabled);
  },
}));

vi.mock('@services/sync/auto-sync/auto-sync-settings', () => ({
  isAutoSyncEnabled: async (provider: string) => state.autoSyncEnabled.get(provider) ?? false,
  setAutoSyncEnabled: async (provider: string, enabled: boolean) => {
    state.autoSyncEnabled.set(provider, enabled);
  },
}));

vi.mock('@services/integrations/anti-hotlink/anti-hotlink-settings', () => ({
  getDefaultAntiHotlinkRulesForSettings: () => [{ domain: 'default.example', referer: 'https://default.example/' }],
  loadAntiHotlinkRulesForSettings: async () => state.antiHotlinkRules.map((rule) => ({ ...rule })),
  saveAntiHotlinkRulesForSettings: async (drafts: Array<{ domain?: unknown; referer?: unknown }>) => {
    const rules = Array.isArray(drafts)
      ? drafts.map((draft) => ({ domain: String(draft?.domain || ''), referer: String(draft?.referer || '') }))
      : [];
    if (rules.some((rule) => !rule.domain || !rule.referer)) {
      return { ok: false, issues: [{ index: 0, field: 'domain', message: 'invalid rule' }] };
    }
    state.antiHotlinkRules = rules;
    return { ok: true, rules };
  },
}));

import {
  PUBLIC_SETTING_KEYS,
  PublicSettingsError,
  getAllPublicSettings,
  getPublicSetting,
  getPublicSettingsSchema,
  setPublicSetting,
} from '@services/settings/public-settings';
import { READER_PREFS_STORAGE_KEY } from '@services/protocols/reader-prefs';

const EXPECTED_KEYS = [
  'profile.user-name',
  'ui.locale',
  'inpage.display',
  'capture.ai-chat-auto-save',
  'capture.ai-chat-cache-images',
  'capture.web-article-cache-images',
  'mention.enabled',
  'anti-hotlink.rules',
  'theme.mode',
  'markdown.reading-profile',
  'provider.notion.enabled',
  'provider.notion.auto-sync',
  'provider.obsidian.enabled',
  'provider.obsidian.auto-sync',
  'provider.feishu.enabled',
  'provider.feishu.auto-sync',
  'provider.github.enabled',
  'provider.github.auto-sync',
  'reader.prefs',
  'reader.tts.ai-api-key',
] as const;

function expectPublicSettingsError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(PublicSettingsError);
  expect((error as PublicSettingsError).code).toBe(code);
}

beforeEach(() => {
  state.storage = {};
  state.inpageMode = 'all';
  state.providerEnabled = new Map();
  state.autoSyncEnabled = new Map();
  state.antiHotlinkRules = [{ domain: 'example.com', referer: 'https://example.com/' }];
});

describe('public settings facade', () => {
  it('owns one exact public key set and emits schema from that same registry', async () => {
    expect(PUBLIC_SETTING_KEYS).toEqual(EXPECTED_KEYS);
    const schema = await getPublicSettingsSchema();
    expect(schema.map((entry) => entry.key)).toEqual(EXPECTED_KEYS);
    expect(schema.every((entry) => typeof entry.type === 'string')).toBe(true);

    const reader = schema.find((entry) => entry.key === 'reader.prefs');
    expect(reader).toMatchObject({ type: 'object', clamp: true });
    expect(reader?.range).toMatchObject({
      fontSize: { min: 14, max: 34 },
      'tts.rate': { min: 0.8, max: 2 },
    });
    expect((reader?.default as any)?.tts?.aiApiKey).toBeUndefined();
    expect((reader?.default as any)?.tts?.aiApiKeyPresent).toBe(false);

    const secret = schema.find((entry) => entry.key === 'reader.tts.ai-api-key');
    expect(secret).toMatchObject({ type: 'secret', writeOnly: true, present: false });
    expect(secret).not.toHaveProperty('default');
  });

  it('preserves the current missing-storage defaults instead of inventing new CLI defaults', async () => {
    const snapshot = await getAllPublicSettings();
    expect(snapshot['profile.user-name']).toBe('You');
    expect(snapshot['ui.locale']).toBe('system');
    expect(snapshot['inpage.display']).toBe('all');
    expect(snapshot['capture.ai-chat-auto-save']).toBe(true);
    expect(snapshot['capture.ai-chat-cache-images']).toBe(false);
    expect(snapshot['capture.web-article-cache-images']).toBe(false);
    expect(snapshot['mention.enabled']).toBe(true);
    expect(snapshot['theme.mode']).toBe('system');
    expect(snapshot['markdown.reading-profile']).toBe('medium');
    expect(snapshot['provider.notion.enabled']).toBe(true);
    expect(snapshot['provider.obsidian.enabled']).toBe(true);
    expect(snapshot['provider.feishu.enabled']).toBe(true);
    expect(snapshot['provider.github.enabled']).toBe(true);
    expect(snapshot['provider.notion.auto-sync']).toBe(false);
    expect(snapshot['provider.obsidian.auto-sync']).toBe(false);
    expect(snapshot['provider.feishu.auto-sync']).toBe(false);
    expect(snapshot['provider.github.auto-sync']).toBe(false);
    expect(snapshot['reader.tts.ai-api-key']).toEqual({ present: false });
  });

  it('never returns raw secrets through reader.prefs, get-all, or schema even when unrelated provider secrets exist in storage', async () => {
    const secret = 'reader-secret-sentinel';
    state.storage.feishu_oauth_client_secret = 'feishu-secret-sentinel';
    state.storage.obsidian_local_rest_api_key_v1 = 'obsidian-secret-sentinel';
    state.storage.github_auth_state_v1 = { accessToken: 'github-token-sentinel', deviceCode: 'github-device-sentinel' };
    const write = await setPublicSetting('reader.tts.ai-api-key', secret);
    expect(write).toEqual({ key: 'reader.tts.ai-api-key', value: { present: true } });
    expect((state.storage[READER_PREFS_STORAGE_KEY] as any)?.tts?.aiApiKey).toBe(secret);

    const prefs = await getPublicSetting('reader.prefs');
    expect((prefs.value as any).tts.aiApiKey).toBeUndefined();
    expect((prefs.value as any).tts.aiApiKeyPresent).toBe(true);

    const secretRead = await getPublicSetting('reader.tts.ai-api-key');
    expect(secretRead.value).toEqual({ present: true });

    const snapshot = await getAllPublicSettings();
    expect((snapshot['reader.prefs'] as any).tts.aiApiKey).toBeUndefined();
    expect(snapshot['reader.tts.ai-api-key']).toEqual({ present: true });

    const schema = await getPublicSettingsSchema();
    const readerDefault = schema.find((entry) => entry.key === 'reader.prefs')?.default as any;
    expect(readerDefault?.tts?.aiApiKey).toBeUndefined();
    expect(schema.find((entry) => entry.key === 'reader.tts.ai-api-key')).toMatchObject({ present: true });
    const safeJson = JSON.stringify({ prefs, secretRead, snapshot, schema });
    expect(safeJson).not.toContain(secret);
    expect(safeJson).not.toContain('feishu-secret-sentinel');
    expect(safeJson).not.toContain('obsidian-secret-sentinel');
    expect(safeJson).not.toContain('github-token-sentinel');
    expect(safeJson).not.toContain('github-device-sentinel');
  });

  it('rebases reader.prefs patches onto the latest durable snapshot and clamps only real numeric values', async () => {
    state.storage[READER_PREFS_STORAGE_KEY] = {
      fontFamily: 'serif',
      fontSize: 19,
      lineHeight: 1.6,
      contentWidth: 1234,
      letterSpacing: 0.01,
      textAlign: 'left',
      tts: {
        engine: 'ai',
        rate: 1.25,
        webVoiceURI: 'voice://one',
        aiEndpoint: 'http://localhost:9999/v1',
        aiApiKey: 'keep-me',
        aiModel: 'model-a',
        aiVoice: 'voice-a',
        aiFormat: 'mp3',
      },
    };

    const result = await setPublicSetting('reader.prefs', { fontSize: 999, tts: { rate: 0.1 } });
    expect(result.value).toMatchObject({
      fontSize: 34,
      contentWidth: 1234,
      tts: { rate: 0.8, aiApiKeyPresent: true, aiModel: 'model-a' },
    });
    expect((state.storage[READER_PREFS_STORAGE_KEY] as any).tts.aiApiKey).toBe('keep-me');

    await expect(setPublicSetting('reader.prefs', { fontSize: '22' })).rejects.toSatisfy((error: unknown) => {
      expectPublicSettingsError(error, 'settings_invalid_value');
      return true;
    });
    await expect(setPublicSetting('reader.prefs', { tts: { rate: '1.5' } })).rejects.toSatisfy((error: unknown) => {
      expectPublicSettingsError(error, 'settings_invalid_value');
      return true;
    });
    await expect(setPublicSetting('reader.prefs', { tts: { aiApiKey: 'blocked' } })).rejects.toSatisfy(
      (error: unknown) => {
        expectPublicSettingsError(error, 'settings_secret_field');
        expect((error as Error).message).not.toContain('blocked');
        return true;
      },
    );
  });

  it('fails closed for unknown/raw keys and invalid typed values', async () => {
    for (const key of [
      'cli-integration-enabled',
      'reader_prefs_v1',
      'feishu_oauth_client_secret',
      'capture.xiaohongshu-comments',
    ]) {
      await expect(setPublicSetting(key, true)).rejects.toSatisfy((error: unknown) => {
        expectPublicSettingsError(error, 'settings_unknown_key');
        return true;
      });
    }

    for (const [key, value] of [
      ['ui.locale', 'fr'],
      ['inpage.display', 'sometimes'],
      ['theme.mode', 'neon'],
      ['markdown.reading-profile', 'raw'],
      ['capture.ai-chat-auto-save', 'true'],
    ] as const) {
      await expect(setPublicSetting(key, value)).rejects.toSatisfy((error: unknown) => {
        expectPublicSettingsError(error, 'settings_invalid_value');
        return true;
      });
    }
  });

  it('routes provider gates, auto-sync, inpage display, anti-hotlink and simple settings through their owners', async () => {
    await expect(setPublicSetting('provider.github.enabled', false)).resolves.toEqual({
      key: 'provider.github.enabled',
      value: false,
    });
    await expect(setPublicSetting('provider.github.auto-sync', true)).resolves.toEqual({
      key: 'provider.github.auto-sync',
      value: true,
    });
    await expect(setPublicSetting('inpage.display', 'off')).resolves.toEqual({ key: 'inpage.display', value: 'off' });
    await expect(
      setPublicSetting('anti-hotlink.rules', [{ domain: 'a.example', referer: 'https://a.example/' }]),
    ).resolves.toEqual({
      key: 'anti-hotlink.rules',
      value: [{ domain: 'a.example', referer: 'https://a.example/' }],
    });
    await expect(setPublicSetting('profile.user-name', '  Alice  ')).resolves.toEqual({
      key: 'profile.user-name',
      value: 'Alice',
    });
    await expect(setPublicSetting('ui.locale', 'zh')).resolves.toEqual({ key: 'ui.locale', value: 'zh' });
    await expect(setPublicSetting('theme.mode', 'dark')).resolves.toEqual({ key: 'theme.mode', value: 'dark' });
    await expect(setPublicSetting('markdown.reading-profile', 'book')).resolves.toEqual({
      key: 'markdown.reading-profile',
      value: 'book',
    });

    expect(state.providerEnabled.get('github')).toBe(false);
    expect(state.autoSyncEnabled.get('github')).toBe(true);
    expect(state.inpageMode).toBe('off');
    expect(state.storage.about_you_user_name).toBe('Alice');
    expect(state.storage.ui_locale_preference_v1).toBe('zh');
    expect(state.storage.app_theme_mode_v1).toBe('dark');
    expect(state.storage.markdown_reading_profile_v1).toBe('book');
  });
});
