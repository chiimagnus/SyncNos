import { onInstalled, onStartup } from '../platform/runtime/runtime';
import { storageGet, storageOnChanged } from '../platform/storage/local';
import { tabsQuery, tabsSendMessage } from '../platform/webext/tabs';

const STORAGE_KEY = 'inpage_supported_only';
const WEB_INPAGE_VISIBILITY_MESSAGE = 'webclipperSetWebInpageEnabled';

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

async function applyVisibilitySetting({ reason }: { reason?: string } = {}) {
  const supportedOnly = await readSetting();

  const tabs = eligibleGenericTabs(await getAllTabs());
  for (const tab of tabs) {
    await sendTabMessage(tab.id, { type: WEB_INPAGE_VISIBILITY_MESSAGE, enabled: supportedOnly ? false : true });
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
