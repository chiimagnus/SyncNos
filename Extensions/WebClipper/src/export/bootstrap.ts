import { backgroundStorage } from '../domains/conversations/background-storage';
import {
  clearNotionOAuthToken,
  getNotionOAuthToken,
  NOTION_OAUTH_TOKEN_KEY,
  setNotionOAuthToken,
} from '../integrations/notion/token-store';
import {
  getObsidianConnectionConfig,
  getObsidianPathConfig,
  getObsidianSettings,
  OBSIDIAN_DEFAULTS,
  OBSIDIAN_STORAGE_KEYS,
  saveObsidianSettings,
} from '../integrations/obsidian/settings-store';

const namespace: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

namespace.backgroundStorage = backgroundStorage;

namespace.notionTokenStore = {
  KEY: NOTION_OAUTH_TOKEN_KEY,
  getToken: getNotionOAuthToken,
  setToken: setNotionOAuthToken,
  clearToken: clearNotionOAuthToken,
};

namespace.obsidianSettingsStore = {
  STORAGE_KEYS: OBSIDIAN_STORAGE_KEYS,
  DEFAULTS: OBSIDIAN_DEFAULTS,
  getSettings: getObsidianSettings,
  getConnectionConfig: getObsidianConnectionConfig,
  getPathConfig: getObsidianPathConfig,
  saveSettings: saveObsidianSettings,
};
