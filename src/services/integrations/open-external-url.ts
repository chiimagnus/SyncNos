import { tabsCreate } from '@platform/webext/tabs';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';

async function openInNewTab(safeUrl: string): Promise<boolean> {
  try {
    await tabsCreate({ url: safeUrl, active: true });
    return true;
  } catch (_error) {
    // Fall back to window.open for test environments and degraded runtimes.
  }

  try {
    globalThis.window?.open(safeUrl, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_error) {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  const safeUrl = sanitizeHttpUrl(url);
  if (!safeUrl) return false;
  return openInNewTab(safeUrl);
}
