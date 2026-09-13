import { tabsCreate } from '@platform/webext/tabs';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';

export async function openExternalUrl(url: string): Promise<boolean> {
  const safeUrl = sanitizeHttpUrl(url);
  if (!safeUrl) return false;
  try {
    await tabsCreate({ url: safeUrl, active: true });
    return true;
  } catch (_error) {
    return false;
  }
}
