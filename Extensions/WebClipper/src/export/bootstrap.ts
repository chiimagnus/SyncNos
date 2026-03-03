import { backgroundStorage } from '../conversations/background-storage';
import {
  clearNotionOAuthToken,
  getNotionOAuthToken,
  NOTION_OAUTH_TOKEN_KEY,
  setNotionOAuthToken,
} from '../sync/notion/auth/token-store';
import { conversationKinds } from '../protocols/conversation-kinds.ts';
import {
  getObsidianConnectionConfig,
  getObsidianPathConfig,
  getObsidianSettings,
  OBSIDIAN_DEFAULTS,
  OBSIDIAN_STORAGE_KEYS,
  saveObsidianSettings,
} from '../sync/obsidian/settings-store';
import runtimeContext from '../runtime-context.ts';

const namespace: any = runtimeContext;

namespace.backgroundStorage = backgroundStorage;

namespace.notionTokenStore = {
  KEY: NOTION_OAUTH_TOKEN_KEY,
  getToken: getNotionOAuthToken,
  setToken: setNotionOAuthToken,
  clearToken: clearNotionOAuthToken,
};
namespace.conversationKinds = conversationKinds;

namespace.obsidianSettingsStore = {
  STORAGE_KEYS: OBSIDIAN_STORAGE_KEYS,
  DEFAULTS: OBSIDIAN_DEFAULTS,
  getSettings: getObsidianSettings,
  getConnectionConfig: getObsidianConnectionConfig,
  getPathConfig: getObsidianPathConfig,
  saveSettings: saveObsidianSettings,
};
