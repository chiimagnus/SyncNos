import runtimeContext from '../../runtime-context.ts';
import {
  getObsidianConnectionConfig,
  getObsidianPathConfig,
  getObsidianSettings,
  OBSIDIAN_DEFAULTS,
  OBSIDIAN_STORAGE_KEYS,
  saveObsidianSettings,
} from './settings-store';

const api = {
  STORAGE_KEYS: OBSIDIAN_STORAGE_KEYS,
  DEFAULTS: OBSIDIAN_DEFAULTS,
  getSettings: getObsidianSettings,
  getConnectionConfig: getObsidianConnectionConfig,
  getPathConfig: getObsidianPathConfig,
  saveSettings: saveObsidianSettings,
};

(runtimeContext as any).obsidianSettingsStore = api;

export {
  OBSIDIAN_STORAGE_KEYS as STORAGE_KEYS,
  OBSIDIAN_DEFAULTS as DEFAULTS,
  getObsidianSettings as getSettings,
  getObsidianConnectionConfig as getConnectionConfig,
  getObsidianPathConfig as getPathConfig,
  saveObsidianSettings as saveSettings,
};
export default api;
