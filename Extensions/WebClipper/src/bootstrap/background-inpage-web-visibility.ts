import { storageGet } from '../platform/storage/local';

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

function getChrome() {
  return (globalThis as any).chrome;
}

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

function canUseScriptingDynamicRegistration() {
  const chrome = getChrome();
  return Boolean(
    chrome &&
      chrome.scripting &&
      typeof chrome.scripting.registerContentScripts === 'function' &&
      typeof chrome.scripting.unregisterContentScripts === 'function',
  );
}

function canUseScriptingInjection() {
  const chrome = getChrome();
  return Boolean(
    chrome &&
      chrome.scripting &&
      typeof chrome.scripting.executeScript === 'function' &&
      typeof chrome.scripting.insertCSS === 'function',
  );
}

function runtimeLastErrorMessage() {
  const chrome = getChrome();
  return String(chrome?.runtime?.lastError?.message || '');
}

function readSetting(): Promise<boolean> {
  return storageGet([STORAGE_KEY])
    .then((res) => (res as any)?.[STORAGE_KEY] === true)
    .catch(() => false);
}

function getContentAssetsFromManifest(): { js: string[]; css: string[] } {
  try {
    const chrome = getChrome();
    const manifest =
      chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function'
        ? chrome.runtime.getManifest()
        : null;
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
    try {
      const chrome = getChrome();
      if (!chrome?.tabs?.query) return resolve([]);
      chrome.tabs.query({}, (tabs: any[]) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch (_e) {
      resolve([]);
    }
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
    try {
      const chrome = getChrome();
      if (!chrome?.tabs?.sendMessage) return resolve({ ok: false });
      chrome.tabs.sendMessage(tabId, message, (res: any) => {
        const errorMessage = runtimeLastErrorMessage();
        if (errorMessage) return resolve({ ok: false, error: errorMessage, response: res || null });
        resolve({ ok: true, response: res || null });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: String((error as any)?.message || error),
      });
    }
  });
}

function injectIntoTab(tabId: number) {
  return new Promise<{ ok: boolean; error?: string | null }>((resolve) => {
    const chrome = getChrome();
    if (!canUseScriptingInjection()) {
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
        new Promise((taskResolve) => {
          chrome.scripting.insertCSS({ target, files: css }, () => {
            const errorMessage = runtimeLastErrorMessage();
            taskResolve({ ok: !errorMessage, error: errorMessage || null });
          });
        }),
      );
    }

    tasks.push(
      new Promise((taskResolve) => {
        chrome.scripting.executeScript({ target, files: js }, () => {
          const errorMessage = runtimeLastErrorMessage();
          taskResolve({ ok: !errorMessage, error: errorMessage || null });
        });
      }),
    );

    Promise.all(tasks).then((results) => {
      const firstError = results.find((item) => !item.ok);
      resolve(firstError ? { ok: false, error: firstError.error } : { ok: true });
    });
  });
}

function registerDynamicContentScript() {
  return new Promise<{ ok: boolean; error?: string; existed?: boolean }>((resolve) => {
    const chrome = getChrome();
    if (!canUseScriptingDynamicRegistration()) {
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

    chrome.scripting.registerContentScripts([definition], () => {
      const errorMessage = runtimeLastErrorMessage();
      if (!errorMessage) return resolve({ ok: true });
      if (/already exists/i.test(errorMessage)) return resolve({ ok: true, existed: true });
      resolve({ ok: false, error: errorMessage });
    });
  });
}

function unregisterDynamicContentScript() {
  return new Promise<{ ok: boolean; error?: string; missing?: boolean }>((resolve) => {
    const chrome = getChrome();
    if (!canUseScriptingDynamicRegistration()) {
      resolve({ ok: false, error: 'dynamic content scripts unavailable' });
      return;
    }
    chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] }, () => {
      const errorMessage = runtimeLastErrorMessage();
      if (!errorMessage) return resolve({ ok: true });
      if (/not found|no such|unknown/i.test(errorMessage)) return resolve({ ok: true, missing: true });
      resolve({ ok: false, error: errorMessage });
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
  const chrome = getChrome();
  try {
    if (chrome?.runtime?.onInstalled?.addListener) {
      chrome.runtime.onInstalled.addListener(() => {
        applyVisibilitySetting({ reason: 'onInstalled' }).catch(() => {});
      });
    }
  } catch (_e) {
    // ignore
  }

  try {
    if (chrome?.runtime?.onStartup?.addListener) {
      chrome.runtime.onStartup.addListener(() => {
        applyVisibilitySetting({ reason: 'onStartup' }).catch(() => {});
      });
    }
  } catch (_e) {
    // ignore
  }

  applyVisibilitySetting({ reason: 'startup' }).catch(() => {});

  try {
    if (chrome?.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes: any, areaName: string) => {
        if (areaName !== 'local') return;
        if (!changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
        applyVisibilitySetting({ reason: 'storageChanged' }).catch(() => {});
      });
    }
  } catch (_e) {
    // ignore
  }
}

const backgroundInpageWebVisibilityApi = {
  STORAGE_KEY,
  applyVisibilitySetting,
  start,
};

export default backgroundInpageWebVisibilityApi;
