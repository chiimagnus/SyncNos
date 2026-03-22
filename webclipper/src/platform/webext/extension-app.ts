import { getURL } from '@platform/runtime/runtime';
import { tabsCreate, tabsQuery, tabsUpdate } from '@platform/webext/tabs';
import { windowsUpdate } from '@platform/webext/windows';

type OpenExtensionAppTabOptions = {
  route?: string;
};

const EXTENSION_APP_PATH = '/app.html';

function normalizeRoute(route?: string): string {
  const value = String(route || '').trim();
  if (!value) return '';
  if (value.startsWith('#')) return value;
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
  return String(url || '').startsWith(baseUrl);
}

async function focusTabWindow(windowId: unknown): Promise<void> {
  const id = Number(windowId);
  if (!Number.isFinite(id) || id < 0) return;
  await windowsUpdate(id, { focused: true });
}

export async function openOrFocusExtensionAppTab(options: OpenExtensionAppTabOptions = {}) {
  const targetUrl = buildExtensionAppUrl(options.route);
  if (!targetUrl) return null;

  const tabs = await tabsQuery({});
  const existing = Array.isArray(tabs) ? tabs.find((tab) => isExtensionAppUrl(tab?.url)) : null;
  const existingId = Number(existing?.id);

  if (existing && Number.isFinite(existingId) && existingId > 0) {
    await focusTabWindow(existing.windowId).catch(() => {});
    await tabsUpdate(existingId, {
      active: true,
      ...(existing.url === targetUrl ? {} : { url: targetUrl }),
    });
    return existing;
  }

  return await tabsCreate({ url: targetUrl, active: true });
}
