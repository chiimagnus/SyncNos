import { onInstalled, onStartup, getManifest } from '../platform/runtime/runtime';
import { storageGet, storageOnChanged } from '../platform/storage/local';
import {
  scriptingCanDynamicRegister,
  scriptingCanInject,
  scriptingExecuteScript,
  scriptingInsertCSS,
  scriptingRegisterContentScripts,
  scriptingUnregisterContentScripts,
} from '../platform/webext/scripting';
import { tabsQuery, tabsSendMessage } from '../platform/webext/tabs';

const STORAGE_KEY = 'inpage_supported_only';
const DYNAMIC_SCRIPT_ID = 'webclipper_inpage_web_dynamic_v1';
const WEB_INPAGE_VISIBILITY_MESSAGE = 'webclipperSetWebInpageEnabled';

const SUPPORTED_EXCLUDE_MATCHES = Object.freeze([
  'https://chat.openai.com/*',
  'https://chatgpt.com/*',
  'https://www.chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://aistudio.google.com/*',
  'https://makersuite.google.com/*',
  'https://chat.deepseek.com/*',
  'https://chat.z.ai/*',
  'https://kimi.moonshot.cn/*',
  'https://kimi.com/*',
  'https://*.kimi.com/*',
  'https://www.doubao.com/*',
  'https://yuanbao.tencent.com/*',
  'https://poe.com/*',
  'https://*.notion.so/*',
]);

const SUPPORTED_HOST_SUFFIXES = Object.freeze([
  'chat.openai.com',
  'chatgpt.com',
  'www.chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'makersuite.google.com',
  'chat.deepseek.com',
  'chat.z.ai',
  'kimi.moonshot.cn',
  'kimi.com',
  'doubao.com',
  'yuanbao.tencent.com',
  'poe.com',
  'notion.so',
]);

function isSupportedHost(hostname: unknown) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const suffix of SUPPORTED_HOST_SUFFIXES) {
    if (host === suffix) return true;
    if (host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

function parseHttpUrl(raw: unknown) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch (_e) {
    return null;
  }
}

function readSetting(): Promise<boolean> {
  return storageGet([STORAGE_KEY])
    .then((res) => (res as any)?.[STORAGE_KEY] === true)
    .catch(() => false);
}

function getContentAssetsFromManifest(): { js: string[]; css: string[] } {
  try {
    const manifest = getManifest();
    const entries = manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    const entry = entries && entries[0] ? entries[0] : null;
    const js = entry && Array.isArray(entry.js) ? entry.js.slice() : [];
    const css = entry && Array.isArray(entry.css) ? entry.css.slice() : [];
    return { js, css };
  } catch (_e) {
    return { js: [], css: [] };
  }
}

function getAllTabs() {
  return new Promise<any[]>((resolve) => {
    tabsQuery({})
      .then((tabs) => resolve(Array.isArray(tabs) ? tabs : []))
      .catch(() => resolve([]));
  });
}

function eligibleGenericTabs(tabs: any[]): Array<{ id: number; url: string }> {
  const list = Array.isArray(tabs) ? tabs : [];
  const output: Array<{ id: number; url: string }> = [];
  for (const tab of list) {
    const id = tab && Number(tab.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const url = parseHttpUrl(tab.url);
    if (!url) continue;
    if (isSupportedHost(url.hostname)) continue;
    output.push({ id, url: url.toString() });
  }
  return output;
}

function sendTabMessage(tabId: number, message: Record<string, unknown>) {
  return new Promise<{ ok: boolean; error?: string; response?: unknown }>((resolve) => {
    tabsSendMessage(tabId, message)
      .then((response) => resolve({ ok: true, response }))
      .catch((error) => resolve({ ok: false, error: String((error as any)?.message || error), response: null }));
  });
}

function injectIntoTab(tabId: number) {
  return new Promise<{ ok: boolean; error?: string | null }>((resolve) => {
    if (!scriptingCanInject()) {
      resolve({ ok: false, error: 'scripting injection unavailable' });
      return;
    }
    const { js, css } = getContentAssetsFromManifest();
    if (!js.length) {
      resolve({ ok: false, error: 'content assets missing' });
      return;
    }

    const target = { tabId, allFrames: false };
    const tasks: Array<Promise<{ ok: boolean; error: string | null }>> = [];

    if (css.length) {
      tasks.push(
        scriptingInsertCSS({ target, files: css })
          .then(() => ({ ok: true, error: null }))
          .catch((e) => ({ ok: false, error: String((e as any)?.message || e) })),
      );
    }

    tasks.push(
      scriptingExecuteScript({ target, files: js })
        .then(() => ({ ok: true, error: null }))
        .catch((e) => ({ ok: false, error: String((e as any)?.message || e) })),
    );

    Promise.all(tasks).then((results) => {
      const firstError = results.find((item) => !item.ok);
      resolve(firstError ? { ok: false, error: firstError.error } : { ok: true });
    });
  });
}

function registerDynamicContentScript() {
  return new Promise<{ ok: boolean; error?: string; existed?: boolean }>((resolve) => {
    if (!scriptingCanDynamicRegister()) {
      resolve({ ok: false, error: 'dynamic content scripts unavailable' });
      return;
    }
    const { js, css } = getContentAssetsFromManifest();
    if (!js.length) {
      resolve({ ok: false, error: 'content assets missing' });
      return;
    }

    const definition = {
      id: DYNAMIC_SCRIPT_ID,
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches: SUPPORTED_EXCLUDE_MATCHES.slice(),
      js,
      css,
      runAt: 'document_idle',
      allFrames: false,
    };

    scriptingRegisterContentScripts([definition])
      .then(() => resolve({ ok: true }))
      .catch((e) => {
        const message = String((e as any)?.message || e || '');
        if (/already exists/i.test(message)) return resolve({ ok: true, existed: true, error: message });
        resolve({ ok: false, error: message });
      });
  });
}

function unregisterDynamicContentScript() {
  return new Promise<{ ok: boolean; error?: string; missing?: boolean }>((resolve) => {
    if (!scriptingCanDynamicRegister()) {
      resolve({ ok: false, error: 'dynamic content scripts unavailable' });
      return;
    }
    scriptingUnregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] })
      .then(() => resolve({ ok: true }))
      .catch((e) => {
        const message = String((e as any)?.message || e || '');
        if (/not found|no such|unknown/i.test(message)) return resolve({ ok: true, missing: true, error: message });
        resolve({ ok: false, error: message });
      });
  });
}

async function applyVisibilitySetting({ reason }: { reason?: string } = {}) {
  const supportedOnly = await readSetting();

  if (supportedOnly) {
    await unregisterDynamicContentScript();
    const tabs = eligibleGenericTabs(await getAllTabs());
    for (const tab of tabs) {
      await sendTabMessage(tab.id, { type: WEB_INPAGE_VISIBILITY_MESSAGE, enabled: false });
    }
    return { ok: true, supportedOnly, reason: reason || 'apply' };
  }

  await registerDynamicContentScript();

  const tabs = eligibleGenericTabs(await getAllTabs());
  for (const tab of tabs) {
    const response = await sendTabMessage(tab.id, { type: WEB_INPAGE_VISIBILITY_MESSAGE, enabled: true });
    if (!response.ok) {
      await injectIntoTab(tab.id);
    }
  }

  return { ok: true, supportedOnly, reason: reason || 'apply' };
}

function start() {
  try {
    onInstalled(() => applyVisibilitySetting({ reason: 'onInstalled' }).catch(() => {}));
  } catch (_e) {}

  try {
    onStartup(() => applyVisibilitySetting({ reason: 'onStartup' }).catch(() => {}));
  } catch (_e) {}

  applyVisibilitySetting({ reason: 'startup' }).catch(() => {});

  try {
    storageOnChanged((changes: any, areaName: string) => {
      if (areaName !== 'local') return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
      applyVisibilitySetting({ reason: 'storageChanged' }).catch(() => {});
    });
  } catch (_e) {}
}

const backgroundInpageWebVisibilityApi = {
  STORAGE_KEY,
  applyVisibilitySetting,
  start,
};

export default backgroundInpageWebVisibilityApi;
