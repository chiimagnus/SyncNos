import { tabsCreate } from '../../platform/webext/tabs';

export const OBSIDIAN_APP_LAUNCH_URL = 'obsidian://open';

function safeString(value: unknown) {
  return String(value == null ? '' : value).trim();
}

export function isLocalObsidianApiBaseUrl(apiBaseUrl?: string) {
  const value = safeString(apiBaseUrl).toLowerCase();
  return value.startsWith('http://127.0.0.1:') || value.startsWith('http://localhost:');
}

export function shouldLaunchObsidianApp(
  error: { code?: string; message?: string } | null | undefined,
  connectionConfig?: { apiBaseUrl?: string },
) {
  return safeString(error?.code) === 'network_error' && isLocalObsidianApiBaseUrl(connectionConfig?.apiBaseUrl);
}

function tryLaunchViaDomAnchor(url: string) {
  const doc = globalThis.document;
  if (!doc?.createElement || !doc.body?.appendChild) return false;

  try {
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.target = '_self';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch (_error) {
    return false;
  }
}

function tryLaunchViaWindowOpen(url: string) {
  try {
    globalThis.window?.open(url, '_self');
    return true;
  } catch (_error) {
    return false;
  }
}

export async function launchObsidianApp(url: string = OBSIDIAN_APP_LAUNCH_URL): Promise<boolean> {
  const safeUrl = safeString(url);
  if (!safeUrl) return false;

  if (tryLaunchViaDomAnchor(safeUrl)) return true;

  try {
    await tabsCreate({ url: safeUrl, active: true });
    return true;
  } catch (_error) {
    // Fall through to browser window APIs when tabs.create is unavailable or rejects custom protocols.
  }

  return tryLaunchViaWindowOpen(safeUrl);
}
