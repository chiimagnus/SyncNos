import { getURL } from '@platform/runtime/runtime';
import { tabsCreate, tabsQuery, tabsUpdate } from '@platform/webext/tabs';
import { windowsUpdate } from '@platform/webext/windows';

type OpenExtensionAppTabOptions = {
  route?: string;
};

const EXTENSION_APP_PATH = '/app.html';

function normalizeRoute(route?: string): string {
  const value = String(route || '').trim();
  if (!value) return '#/';
  if (value.startsWith('/')) return `#${value}`;
  return `#/${value}`;
}

function buildExtensionAppUrl(route?: string): string {
  const baseUrl = getURL(EXTENSION_APP_PATH);
  if (!baseUrl) return '';
  return `${baseUrl}${normalizeRoute(route)}`;
}

function isExtensionAppUrl(url: unknown): boolean {
  const baseUrl = getURL(EXTENSION_APP_PATH);
  if (!baseUrl) return false;
  const value = String(url || '');
  if (!value.startsWith(baseUrl)) return false;
  const suffix = value.slice(baseUrl.length);
  return suffix === '' || suffix.startsWith('#');
}

async function focusTabWindow(windowId: unknown): Promise<void> {
  const id = Number(windowId);
  if (!Number.isFinite(id) || id < 0) return;
  await windowsUpdate(id, { focused: true });
}

async function findExtensionAppTab() {
  const tabs = await tabsQuery({});
  return tabs.find((tab) => isExtensionAppUrl(tab?.url)) ?? null;
}

export async function openOrFocusExtensionAppTab(options: OpenExtensionAppTabOptions = {}) {
  const targetUrl = buildExtensionAppUrl(options.route);
  if (!targetUrl) return null;

  const existing = await findExtensionAppTab();
  const existingId = Number(existing?.id);

  if (existing && Number.isFinite(existingId) && existingId > 0) {
    const updated = await tabsUpdate(existingId, {
      active: true,
      ...(existing.url === targetUrl ? {} : { url: targetUrl }),
    });
    // Popup 会在目标窗口获得焦点时被销毁；先完成目标 tab 的激活与导航。
    await focusTabWindow(existing.windowId).catch(() => {});
    return updated ?? existing;
  }

  return await tabsCreate({ url: targetUrl, active: true });
}

export async function ensureExtensionAppTab() {
  const targetUrl = buildExtensionAppUrl('/');
  if (!targetUrl) return null;

  const existing = await findExtensionAppTab();
  if (existing) return existing;

  return await tabsCreate({ url: targetUrl, active: false });
}
