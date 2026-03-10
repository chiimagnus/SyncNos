import { t } from '../../i18n';
import { CURRENT_PAGE_MESSAGE_TYPES } from '../messaging/message-contracts';
import { storageGet, storageOnChanged, storageSet } from '../storage/local';
import { tabsQuery, tabsSendMessage } from '../webext/tabs';

type InpageDisplayMode = 'supported' | 'all' | 'off';

const STORAGE_KEY_DISPLAY_MODE = 'inpage_display_mode';
const STORAGE_KEY_SUPPORTED_ONLY = 'inpage_supported_only';
const STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED = 'ai_chat_auto_save_enabled';

const MENU_ROOT_ID = 'syncnos_clipper_root';
const MENU_SAVE_CURRENT_PAGE_ID = 'syncnos_clipper_save_current_page';
const MENU_INPAGE_GROUP_ID = 'syncnos_clipper_inpage_group';
const MENU_AUTOSAVE_ID = 'syncnos_clipper_autosave';
const MENU_MODE_SUPPORTED_ID = 'syncnos_clipper_mode_supported';
const MENU_MODE_ALL_ID = 'syncnos_clipper_mode_all';
const MENU_MODE_OFF_ID = 'syncnos_clipper_mode_off';

function normalizeInpageDisplayMode(value: unknown): InpageDisplayMode | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'supported' || raw === 'all' || raw === 'off') return raw as InpageDisplayMode;
  return null;
}

function displayModeFromLegacySupportedOnly(value: unknown): InpageDisplayMode {
  return value === true ? 'supported' : 'all';
}

function getMenusApi(): any | null {
  const anyGlobal = globalThis as any;
  return (
    anyGlobal.browser?.contextMenus ??
    anyGlobal.chrome?.contextMenus ??
    anyGlobal.browser?.menus ??
    anyGlobal.chrome?.menus ??
    null
  );
}

function promisifyVoid(fn: (cb: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    try {
      fn(() => resolve());
    } catch (_e) {
      resolve();
    }
  });
}

async function readMenuState(): Promise<{ mode: InpageDisplayMode; autoSave: boolean }> {
  try {
    const local = await storageGet([STORAGE_KEY_DISPLAY_MODE, STORAGE_KEY_SUPPORTED_ONLY, STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED]);
    const normalizedMode = normalizeInpageDisplayMode(local?.[STORAGE_KEY_DISPLAY_MODE]);
    const mode = normalizedMode || displayModeFromLegacySupportedOnly(local?.[STORAGE_KEY_SUPPORTED_ONLY]);
    const autoSave = local?.[STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED] !== false;
    return { mode, autoSave };
  } catch (_e) {
    return { mode: 'all', autoSave: true };
  }
}

async function removeAllMenus(api: any): Promise<void> {
  if (!api?.removeAll) return;
  await promisifyVoid((cb) => api.removeAll(cb));
}

function isHttpUrl(raw: unknown) {
  const url = String(raw || '').trim();
  return /^https?:\/\//i.test(url);
}

async function captureActiveTabCurrentPage(): Promise<void> {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
  const tabId = Number(tab?.id);

  if (!tab || !Number.isFinite(tabId) || tabId <= 0) return;
  if (!isHttpUrl(tab.url)) return;

  await tabsSendMessage(tabId, { type: CURRENT_PAGE_MESSAGE_TYPES.CAPTURE });
}

async function createOrRefreshMenus(api: any) {
  if (!api?.create) return;
  const state = await readMenuState();

  await removeAllMenus(api);

  const base = {
    contexts: ['page'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  } as any;

  api.create({
    ...base,
    id: MENU_ROOT_ID,
    title: t('contextMenuRootTitle'),
  });

  api.create({
    ...base,
    id: MENU_SAVE_CURRENT_PAGE_ID,
    parentId: MENU_ROOT_ID,
    title: t('contextMenuSaveCurrentPage'),
  });

  api.create({
    ...base,
    id: MENU_INPAGE_GROUP_ID,
    parentId: MENU_ROOT_ID,
    title: t('contextMenuInpageGroupTitle'),
  });

  api.create({
    ...base,
    id: MENU_MODE_SUPPORTED_ID,
    parentId: MENU_INPAGE_GROUP_ID,
    type: 'radio',
    title: t('inpageDisplayModeSupported'),
    checked: state.mode === 'supported',
  });
  api.create({
    ...base,
    id: MENU_MODE_ALL_ID,
    parentId: MENU_INPAGE_GROUP_ID,
    type: 'radio',
    title: t('inpageDisplayModeAll'),
    checked: state.mode === 'all',
  });
  api.create({
    ...base,
    id: MENU_MODE_OFF_ID,
    parentId: MENU_INPAGE_GROUP_ID,
    type: 'radio',
    title: t('inpageDisplayModeOff'),
    checked: state.mode === 'off',
  });

  api.create({
    ...base,
    id: MENU_AUTOSAVE_ID,
    parentId: MENU_ROOT_ID,
    type: 'checkbox',
    title: t('aiChatAutoSaveLabel'),
    checked: state.autoSave,
  });
}

async function updateCheckedStates(api: any, state: { mode: InpageDisplayMode; autoSave: boolean }) {
  if (!api?.update) return;
  try {
    api.update(MENU_MODE_SUPPORTED_ID, { checked: state.mode === 'supported' });
    api.update(MENU_MODE_ALL_ID, { checked: state.mode === 'all' });
    api.update(MENU_MODE_OFF_ID, { checked: state.mode === 'off' });
    api.update(MENU_AUTOSAVE_ID, { checked: state.autoSave });
  } catch (_e) {
    // ignore
  }
}

let registered = false;
let removeStorageListener: (() => void) | null = null;

export function registerClipperContextMenu(): void {
  if (registered) return;
  registered = true;

  const api = getMenusApi();
  if (!api) return;

  void createOrRefreshMenus(api);

  try {
    api.onClicked?.addListener?.((info: any) => {
      const id = String(info?.menuItemId || '');
      if (!id) return;

      if (id === MENU_SAVE_CURRENT_PAGE_ID) {
        void captureActiveTabCurrentPage().catch(() => {});
        return;
      }

      if (id === MENU_AUTOSAVE_ID) {
        const checked = info?.checked === true;
        void storageSet({ [STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED]: checked }).catch(() => {});
        return;
      }

      if (id === MENU_MODE_SUPPORTED_ID) {
        void storageSet({ [STORAGE_KEY_DISPLAY_MODE]: 'supported' }).catch(() => {});
        return;
      }
      if (id === MENU_MODE_ALL_ID) {
        void storageSet({ [STORAGE_KEY_DISPLAY_MODE]: 'all' }).catch(() => {});
        return;
      }
      if (id === MENU_MODE_OFF_ID) {
        void storageSet({ [STORAGE_KEY_DISPLAY_MODE]: 'off' }).catch(() => {});
        return;
      }
    });
  } catch (_e) {
    // ignore
  }

  removeStorageListener = storageOnChanged((changes: any, areaName: string) => {
    if (areaName !== 'local') return;
    const keys = changes ? Object.keys(changes) : [];
    if (!keys.length) return;
    if (!keys.includes(STORAGE_KEY_DISPLAY_MODE) && !keys.includes(STORAGE_KEY_SUPPORTED_ONLY) && !keys.includes(STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED)) {
      return;
    }
    void readMenuState().then((state) => updateCheckedStates(api, state));
  });
}

export function unregisterClipperContextMenu(): void {
  registered = false;
  try {
    removeStorageListener?.();
  } catch (_e) {
    // ignore
  }
  removeStorageListener = null;
}
