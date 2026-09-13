import {
  APP_THEME_MODES,
  APP_THEME_MODE_STORAGE_KEY,
  buildAppThemeModeStoragePatch,
  isAppThemeMode,
  resolveAppThemeModeFromStorage,
} from '@services/protocols/app-theme';
import {
  LOCALE_PREFERENCES,
  LOCALE_PREFERENCE_STORAGE_KEY,
  buildLocalePreferenceStoragePatch,
  isLocalePreference,
  normalizeLocalePreference,
} from '@services/protocols/locale-preference';
import {
  MARKDOWN_READING_PROFILE_STORAGE_KEY,
  buildMarkdownReadingProfileStoragePatch,
  normalizeStoredMarkdownReadingProfile,
} from '@services/protocols/markdown-reading-profile-storage';
import {
  MARKDOWN_READING_PROFILE_IDS,
  isMarkdownReadingProfileId,
} from '@services/protocols/markdown-reading-profiles';
import {
  DEFAULT_READER_PREFS,
  READER_FONT_FAMILIES,
  READER_PREFS_LIMITS,
  READER_PREFS_STORAGE_KEY,
  READER_TEXT_ALIGNS,
  READER_TTS_AUDIO_FORMATS,
  READER_TTS_ENGINES,
  applyReaderPrefsPatch,
  buildReaderPrefsStoragePatch,
  resolveReaderPrefsFromStorage,
  type ReaderPrefs,
  type ReaderPrefsPatch,
} from '@services/protocols/reader-prefs';
import {
  getDefaultAntiHotlinkRulesForSettings,
  loadAntiHotlinkRulesForSettings,
  saveAntiHotlinkRulesForSettings,
} from '@services/integrations/anti-hotlink/anti-hotlink-settings';
import {
  normalizeInpageDisplayMode,
  readEffectiveInpageDisplayMode,
  setCanonicalInpageDisplayMode,
} from '@services/shared/inpage-display-mode';
import {
  ABOUT_YOU_USER_NAME_STORAGE_KEY,
  DEFAULT_ABOUT_YOU_USER_NAME,
  normalizeUserName,
  resolveAboutYouUserName,
} from '@services/shared/user-profile';
import { storageGet, storageSet } from '@services/shared/storage';
import { isAutoSyncEnabled, setAutoSyncEnabled } from '@services/sync/auto-sync/auto-sync-settings';
import { isSyncProviderEnabled, setSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import type { SyncProvider } from '@services/sync/models';

export type PublicSettingKey =
  | 'profile.user-name'
  | 'ui.locale'
  | 'inpage.display'
  | 'capture.ai-chat-auto-save'
  | 'capture.ai-chat-cache-images'
  | 'capture.web-article-cache-images'
  | 'capture.xiaohongshu-comments'
  | 'mention.enabled'
  | 'anti-hotlink.rules'
  | 'theme.mode'
  | 'markdown.reading-profile'
  | `provider.${SyncProvider}.enabled`
  | `provider.${SyncProvider}.auto-sync`
  | 'reader.prefs'
  | 'reader.tts.ai-api-key';

export type PublicSettingSchemaEntry = {
  key: PublicSettingKey;
  type: 'boolean' | 'string' | 'enum' | 'object' | 'secret';
  default?: unknown;
  enum?: readonly string[];
  range?: Record<string, { min: number; max: number }>;
  writeOnly?: boolean;
  clamp?: boolean;
  present?: boolean;
};

type Descriptor = Omit<PublicSettingSchemaEntry, 'key' | 'present'> & {
  read: () => Promise<unknown>;
  write: (value: unknown) => Promise<unknown>;
  present?: () => Promise<boolean>;
};

export class PublicSettingsError extends Error {
  readonly code: string;
  readonly extra: unknown;

  constructor(code: string, message: string, extra: unknown = null) {
    super(message);
    this.name = 'PublicSettingsError';
    this.code = code;
    this.extra = extra;
  }
}

function invalid(key: string, message = `Invalid value for ${key}`, extra: unknown = null): never {
  throw new PublicSettingsError('settings_invalid_value', message, extra);
}

function requireBoolean(key: string, value: unknown): boolean {
  if (typeof value !== 'boolean') invalid(key, `${key} requires a boolean`);
  return value;
}

function requireString(key: string, value: unknown): string {
  if (typeof value !== 'string') invalid(key, `${key} requires a string`);
  return value;
}

async function readStorageValue(key: string): Promise<unknown> {
  const local = await storageGet([key]);
  return local?.[key];
}

function booleanStorageDescriptor(input: { key: string; defaultValue: boolean }): Descriptor {
  return {
    type: 'boolean',
    default: input.defaultValue,
    read: async () => {
      const value = await readStorageValue(input.key);
      return input.defaultValue ? value !== false : value === true;
    },
    write: async (value) => {
      const normalized = requireBoolean(input.key, value);
      await storageSet({ [input.key]: normalized });
      return normalized;
    },
  };
}

function safeReaderPrefs(prefs: ReaderPrefs) {
  const { aiApiKey, ...safeTts } = prefs.tts;
  return {
    ...prefs,
    tts: {
      ...safeTts,
      aiApiKeyPresent: !!aiApiKey,
    },
  };
}

const READER_TOP_LEVEL_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'contentWidth',
  'letterSpacing',
  'textAlign',
  'tts',
]);
const READER_TTS_KEYS = new Set(['engine', 'rate', 'webVoiceURI', 'aiEndpoint', 'aiModel', 'aiVoice', 'aiFormat']);

function validateReaderPatch(value: unknown): ReaderPrefsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('reader.prefs', 'reader.prefs requires an object');
  const patch = value as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (!READER_TOP_LEVEL_KEYS.has(key)) invalid('reader.prefs', `Unknown reader.prefs field: ${key}`);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'fontFamily') &&
    !READER_FONT_FAMILIES.includes(patch.fontFamily as any)
  ) {
    invalid('reader.prefs', 'Invalid reader fontFamily');
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'textAlign') &&
    !READER_TEXT_ALIGNS.includes(patch.textAlign as any)
  ) {
    invalid('reader.prefs', 'Invalid reader textAlign');
  }
  for (const key of ['fontSize', 'lineHeight', 'contentWidth', 'letterSpacing'] as const) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (typeof patch[key] !== 'number' || !Number.isFinite(patch[key]))
      invalid('reader.prefs', `Invalid reader ${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tts')) {
    if (!patch.tts || typeof patch.tts !== 'object' || Array.isArray(patch.tts)) {
      invalid('reader.prefs', 'reader.prefs.tts requires an object');
    }
    const tts = patch.tts as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(tts, 'aiApiKey')) {
      throw new PublicSettingsError(
        'settings_secret_field',
        'Use reader.tts.ai-api-key to change the Reader TTS API key',
      );
    }
    for (const key of Object.keys(tts)) {
      if (!READER_TTS_KEYS.has(key)) invalid('reader.prefs', `Unknown reader.prefs.tts field: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(tts, 'engine') && !READER_TTS_ENGINES.includes(tts.engine as any)) {
      invalid('reader.prefs', 'Invalid Reader TTS engine');
    }
    if (
      Object.prototype.hasOwnProperty.call(tts, 'aiFormat') &&
      !READER_TTS_AUDIO_FORMATS.includes(tts.aiFormat as any)
    ) {
      invalid('reader.prefs', 'Invalid Reader TTS audio format');
    }
    if (
      Object.prototype.hasOwnProperty.call(tts, 'rate') &&
      (typeof tts.rate !== 'number' || !Number.isFinite(tts.rate))
    ) {
      invalid('reader.prefs', 'Invalid Reader TTS rate');
    }
    for (const key of ['webVoiceURI', 'aiEndpoint', 'aiModel', 'aiVoice'] as const) {
      if (Object.prototype.hasOwnProperty.call(tts, key) && typeof tts[key] !== 'string') {
        invalid('reader.prefs', `Invalid Reader TTS ${key}`);
      }
    }
  }
  return patch as ReaderPrefsPatch;
}

async function readReaderPrefs(): Promise<ReaderPrefs> {
  const local = await storageGet([READER_PREFS_STORAGE_KEY]);
  return resolveReaderPrefsFromStorage(local);
}

async function writeReaderPrefsPatch(value: unknown) {
  const patch = validateReaderPatch(value);
  const current = await readReaderPrefs();
  const next = applyReaderPrefsPatch(current, patch);
  await storageSet(buildReaderPrefsStoragePatch(next));
  return safeReaderPrefs(next);
}

function providerEnabledDescriptor(provider: SyncProvider): Descriptor {
  return {
    type: 'boolean',
    default: true,
    read: () => isSyncProviderEnabled(provider),
    write: async (value) => {
      const enabled = requireBoolean(`provider.${provider}.enabled`, value);
      await setSyncProviderEnabled(provider, enabled);
      return enabled;
    },
  };
}

function providerAutoSyncDescriptor(provider: SyncProvider): Descriptor {
  return {
    type: 'boolean',
    default: false,
    read: () => isAutoSyncEnabled(provider),
    write: async (value) => {
      const enabled = requireBoolean(`provider.${provider}.auto-sync`, value);
      await setAutoSyncEnabled(provider, enabled);
      return enabled;
    },
  };
}

const descriptors: Record<PublicSettingKey, Descriptor> = {
  'profile.user-name': {
    type: 'string',
    default: DEFAULT_ABOUT_YOU_USER_NAME,
    read: async () => resolveAboutYouUserName(await readStorageValue(ABOUT_YOU_USER_NAME_STORAGE_KEY)),
    write: async (value) => {
      const normalized = normalizeUserName(requireString('profile.user-name', value));
      await storageSet({ [ABOUT_YOU_USER_NAME_STORAGE_KEY]: normalized });
      return resolveAboutYouUserName(normalized);
    },
  },
  'ui.locale': {
    type: 'enum',
    default: 'system',
    enum: LOCALE_PREFERENCES,
    read: async () => normalizeLocalePreference(await readStorageValue(LOCALE_PREFERENCE_STORAGE_KEY)),
    write: async (value) => {
      if (!isLocalePreference(value)) invalid('ui.locale');
      const patch = buildLocalePreferenceStoragePatch(value);
      await storageSet(patch);
      return patch[LOCALE_PREFERENCE_STORAGE_KEY];
    },
  },
  'inpage.display': {
    type: 'enum',
    default: 'all',
    enum: ['supported', 'all', 'off'],
    read: readEffectiveInpageDisplayMode,
    write: async (value) => {
      const mode = normalizeInpageDisplayMode(value);
      if (!mode) invalid('inpage.display');
      return setCanonicalInpageDisplayMode(mode);
    },
  },
  'capture.ai-chat-auto-save': booleanStorageDescriptor({ key: 'ai_chat_auto_save_enabled', defaultValue: true }),
  'capture.ai-chat-cache-images': booleanStorageDescriptor({
    key: 'ai_chat_cache_images_enabled',
    defaultValue: false,
  }),
  'capture.web-article-cache-images': booleanStorageDescriptor({
    key: 'web_article_cache_images_enabled',
    defaultValue: false,
  }),
  'capture.xiaohongshu-comments': booleanStorageDescriptor({
    key: 'xiaohongshu_comments_capture_enabled',
    defaultValue: false,
  }),
  'mention.enabled': booleanStorageDescriptor({ key: 'ai_chat_dollar_mention_enabled', defaultValue: true }),
  'anti-hotlink.rules': {
    type: 'object',
    default: getDefaultAntiHotlinkRulesForSettings(),
    read: () => loadAntiHotlinkRulesForSettings({ forceRefresh: true }),
    write: async (value) => {
      if (!Array.isArray(value)) invalid('anti-hotlink.rules', 'anti-hotlink.rules requires a JSON array');
      const result = await saveAntiHotlinkRulesForSettings(value as any[]);
      if (!result.ok) invalid('anti-hotlink.rules', 'Invalid anti-hotlink rules', { issues: result.issues });
      return result.rules;
    },
  },
  'theme.mode': {
    type: 'enum',
    default: 'system',
    enum: APP_THEME_MODES,
    read: async () => resolveAppThemeModeFromStorage(await storageGet([APP_THEME_MODE_STORAGE_KEY])),
    write: async (value) => {
      if (!isAppThemeMode(value)) invalid('theme.mode');
      const patch = buildAppThemeModeStoragePatch(value);
      await storageSet(patch);
      return patch[APP_THEME_MODE_STORAGE_KEY];
    },
  },
  'markdown.reading-profile': {
    type: 'enum',
    default: 'medium',
    enum: MARKDOWN_READING_PROFILE_IDS,
    read: async () =>
      normalizeStoredMarkdownReadingProfile(await readStorageValue(MARKDOWN_READING_PROFILE_STORAGE_KEY)),
    write: async (value) => {
      if (!isMarkdownReadingProfileId(value)) invalid('markdown.reading-profile');
      const patch = buildMarkdownReadingProfileStoragePatch(value);
      await storageSet(patch);
      return patch[MARKDOWN_READING_PROFILE_STORAGE_KEY];
    },
  },
  'provider.notion.enabled': providerEnabledDescriptor('notion'),
  'provider.notion.auto-sync': providerAutoSyncDescriptor('notion'),
  'provider.obsidian.enabled': providerEnabledDescriptor('obsidian'),
  'provider.obsidian.auto-sync': providerAutoSyncDescriptor('obsidian'),
  'provider.feishu.enabled': providerEnabledDescriptor('feishu'),
  'provider.feishu.auto-sync': providerAutoSyncDescriptor('feishu'),
  'provider.github.enabled': providerEnabledDescriptor('github'),
  'provider.github.auto-sync': providerAutoSyncDescriptor('github'),
  'reader.prefs': {
    type: 'object',
    default: safeReaderPrefs(DEFAULT_READER_PREFS),
    clamp: true,
    range: {
      fontSize: READER_PREFS_LIMITS.fontSize,
      lineHeight: READER_PREFS_LIMITS.lineHeight,
      contentWidth: READER_PREFS_LIMITS.contentWidth,
      letterSpacing: READER_PREFS_LIMITS.letterSpacing,
      'tts.rate': READER_PREFS_LIMITS.tts.rate,
    },
    read: async () => safeReaderPrefs(await readReaderPrefs()),
    write: writeReaderPrefsPatch,
  },
  'reader.tts.ai-api-key': {
    type: 'secret',
    writeOnly: true,
    read: async () => ({ present: !!(await readReaderPrefs()).tts.aiApiKey }),
    present: async () => !!(await readReaderPrefs()).tts.aiApiKey,
    write: async (value) => {
      const apiKey = requireString('reader.tts.ai-api-key', value);
      const current = await readReaderPrefs();
      const next = applyReaderPrefsPatch(current, { tts: { aiApiKey: apiKey } });
      await storageSet(buildReaderPrefsStoragePatch(next));
      return { present: !!apiKey };
    },
  },
};

export const PUBLIC_SETTING_KEYS = Object.freeze(Object.keys(descriptors) as PublicSettingKey[]);

function descriptorFor(keyInput: unknown): { key: PublicSettingKey; descriptor: Descriptor } {
  const key = String(keyInput || '').trim() as PublicSettingKey;
  const descriptor = descriptors[key];
  if (!descriptor) throw new PublicSettingsError('settings_unknown_key', `Unknown public setting: ${key || '(empty)'}`);
  return { key, descriptor };
}

export async function getPublicSetting(keyInput: unknown): Promise<{ key: PublicSettingKey; value: unknown }> {
  const { key, descriptor } = descriptorFor(keyInput);
  return { key, value: await descriptor.read() };
}

export async function getAllPublicSettings(): Promise<Record<PublicSettingKey, unknown>> {
  const entries = await Promise.all(
    PUBLIC_SETTING_KEYS.map(async (key) => [key, await descriptors[key].read()] as const),
  );
  return Object.fromEntries(entries) as Record<PublicSettingKey, unknown>;
}

export async function setPublicSetting(
  keyInput: unknown,
  value: unknown,
): Promise<{ key: PublicSettingKey; value: unknown }> {
  const { key, descriptor } = descriptorFor(keyInput);
  return { key, value: await descriptor.write(value) };
}

export async function getPublicSettingsSchema(): Promise<PublicSettingSchemaEntry[]> {
  return await Promise.all(
    PUBLIC_SETTING_KEYS.map(async (key) => {
      const descriptor = descriptors[key];
      const { read: _read, write: _write, present, ...schema } = descriptor;
      return {
        key,
        ...schema,
        ...(present ? { present: await present() } : {}),
      };
    }),
  );
}
