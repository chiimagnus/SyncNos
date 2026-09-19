import { t } from '@i18n';
import { CURRENT_PAGE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { storageGet, storageOnChanged, storageSet } from '@platform/storage/local';
import { tabsQuery, tabsSendMessage } from '@platform/webext/tabs';

type InpageDisplayMode = 'supported' | 'all' | 'off';

const STORAGE_KEY_DISPLAY_MODE = 'inpage_display_mode';
const STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED = 'ai_chat_auto_save_enabled';

const MENU_ROOT_ID = 'syncnos_clipper_root';
const MENU_SAVE_CURRENT_PAGE_ID = 'syncnos_clipper_save_current_page';
const MENU_INPAGE_GROUP_ID = 'syncnos_clipper_inpage_group';
const MENU_AUTOSAVE_ID = 'syncnos_clipper_autosave';
const MENU_MODE_SUPPORTED_ID = 'syncnos_clipper_mode_supported';
const MENU_MODE_ALL_ID = 'syncnos_clipper_mode_all';
const MENU_MODE_OFF_ID = 'syncnos_clipper_mode_off';

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

async function readMenuState(
  readDisplayMode: () => Promise<InpageDisplayMode>,
): Promise<{ mode: InpageDisplayMode; autoSave: boolean }> {
  const [mode, local] = await Promise.all([readDisplayMode(), storageGet([STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED])]);
  return { mode, autoSave: local?.[STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED] !== false };
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

  await tabsSendMessage(tabId, { type: CURRENT_PAGE_MESSAGE_TYPES.CAPTURE, payload: { source: 'contextmenu' } });
}

async function resolveSaveMenuTitle(tab: { id?: unknown; url?: unknown } | null): Promise<string> {
  let title = t('contextMenuSaveCurrentPage');
  const tabId = Number(tab?.id);
  if (!Number.isFinite(tabId) || tabId <= 0 || !isHttpUrl(tab?.url)) return title;

  try {
    const response = await tabsSendMessage(tabId, { type: CURRENT_PAGE_MESSAGE_TYPES.GET_CAPTURE_STATE });
    const ok = !!response && typeof response === 'object' && (response as any).ok === true;
    const kind = ok ? String((response as any).data?.kind || '') : '';
    if (kind === 'chat') title = t('contextMenuSaveCurrentAiChat');
    else if (kind === 'video') title = t('contextMenuSaveCurrentVideoTranscript');
  } catch (_e) {
    // Keep the generic localized title when the page cannot answer.
  }
  return title;
}

async function updateMenuItem(api: any, id: string, update: Record<string, unknown>): Promise<void> {
  if (!api?.update) return;
  try {
    await Promise.resolve(api.update(id, update));
  } catch (_e) {
    // Context menu presentation refresh is best-effort.
  }
}

async function refreshVisibleMenus(
  api: any,
  state: { mode: InpageDisplayMode; autoSave: boolean } | null,
  tab: { id?: unknown; url?: unknown } | null,
): Promise<void> {
  const saveTitle = await resolveSaveMenuTitle(tab);
  await Promise.all([
    updateMenuItem(api, MENU_ROOT_ID, { title: t('contextMenuRootTitle') }),
    updateMenuItem(api, MENU_SAVE_CURRENT_PAGE_ID, { title: saveTitle }),
    updateMenuItem(api, MENU_INPAGE_GROUP_ID, { title: t('contextMenuInpageGroupTitle') }),
    updateMenuItem(api, MENU_MODE_SUPPORTED_ID, {
      title: t('inpageDisplayModeSupported'),
      ...(state ? { checked: state.mode === 'supported' } : null),
    }),
    updateMenuItem(api, MENU_MODE_ALL_ID, {
      title: t('inpageDisplayModeAll'),
      ...(state ? { checked: state.mode === 'all' } : null),
    }),
    updateMenuItem(api, MENU_MODE_OFF_ID, {
      title: t('inpageDisplayModeOff'),
      ...(state ? { checked: state.mode === 'off' } : null),
    }),
    updateMenuItem(api, MENU_AUTOSAVE_ID, {
      title: t('aiChatAutoSaveLabel'),
      ...(state ? { checked: state.autoSave } : null),
    }),
  ]);

  try {
    await Promise.resolve(api?.refresh?.());
  } catch (_e) {
    // Context menu refresh is best-effort.
  }
}

async function createOrRefreshMenus(api: any, readDisplayMode: () => Promise<InpageDisplayMode>) {
  if (!api?.create) return;
  const state = await readMenuState(readDisplayMode).catch(() => ({ mode: 'all' as const, autoSave: true }));

  if (api.removeAll) {
    await Promise.resolve(api.removeAll());
  }

  const base = {
    contexts: ['page', 'selection'],
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
  await Promise.all([
    updateMenuItem(api, MENU_MODE_SUPPORTED_ID, { checked: state.mode === 'supported' }),
    updateMenuItem(api, MENU_MODE_ALL_ID, { checked: state.mode === 'all' }),
    updateMenuItem(api, MENU_MODE_OFF_ID, { checked: state.mode === 'off' }),
    updateMenuItem(api, MENU_AUTOSAVE_ID, { checked: state.autoSave }),
  ]);
}

type ContextMenuRegistrationOptions = {
  ensureReady: () => Promise<unknown>;
  readDisplayMode: () => Promise<InpageDisplayMode>;
  setDisplayMode: (mode: InpageDisplayMode) => Promise<unknown>;
};

export type ClipperContextMenuController = {
  installOrRefresh: () => Promise<void>;
};

export function registerClipperContextMenu(options: ContextMenuRegistrationOptions): ClipperContextMenuController {
  const api = getMenusApi();
  if (!api) return { installOrRefresh: async () => {} };

  const ensureReady = options.ensureReady;
  const readDisplayMode = options.readDisplayMode;
  const setDisplayMode = options.setDisplayMode;

  try {
    api.onClicked?.addListener?.((info: any, _tab: any) => {
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

      const requestedMode: InpageDisplayMode | null =
        id === MENU_MODE_SUPPORTED_ID
          ? 'supported'
          : id === MENU_MODE_ALL_ID
            ? 'all'
            : id === MENU_MODE_OFF_ID
              ? 'off'
              : null;
      if (requestedMode) {
        void setDisplayMode(requestedMode).catch(() => {
          void readMenuState(readDisplayMode)
            .then((state) => updateCheckedStates(api, state))
            .catch(() => {});
        });
      }
    });
  } catch (_e) {
    // ignore
  }

  try {
    api.onShown?.addListener?.((info: any, tab: any) => {
      if (!info) return;
      void Promise.resolve()
        .then(() => ensureReady())
        .catch(() => undefined)
        .then(async () => {
          const state = await readMenuState(readDisplayMode).catch(() => null);
          await refreshVisibleMenus(api, state, tab || null);
        })
        .catch(() => {});
    });
  } catch (_e) {
    // ignore
  }

  storageOnChanged((changes: any, areaName: string) => {
    if (areaName !== 'local') return;
    const keys = changes ? Object.keys(changes) : [];
    if (!keys.length) return;
    if (!keys.includes(STORAGE_KEY_DISPLAY_MODE) && !keys.includes(STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED)) return;
    void readMenuState(readDisplayMode)
      .then((state) => updateCheckedStates(api, state))
      .catch(() => {});
  });

  return {
    async installOrRefresh() {
      await Promise.resolve(ensureReady());
      await createOrRefreshMenus(api, readDisplayMode);
    },
  };
}
