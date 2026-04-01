import { openExternalUrl } from '@services/integrations/open-external-url';
import type { ChatWithAiPlatform } from '@services/integrations/chatwith/chatwith-settings';

export type ChatWithOpenPlatformPort = {
  openPlatform: (platformId: string, fallbackUrl?: string | null) => Promise<boolean>;
};

function safeText(value: unknown): string {
  return String(value || '').trim();
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(safeText(url));
}

export const defaultChatWithOpenPlatformPort: ChatWithOpenPlatformPort = {
  async openPlatform(_platformId, fallbackUrl) {
    const href = safeText(fallbackUrl);
    if (!href || !isHttpUrl(href)) return false;
    return openExternalUrl(href);
  },
};

export async function openChatWithPlatform(input: {
  platform: ChatWithAiPlatform;
  port?: ChatWithOpenPlatformPort | null;
}): Promise<boolean> {
  const platform = input.platform;
  const platformId = safeText(platform?.id);
  const fallbackUrl = safeText(platform?.url);
  if (!platformId) return false;
  if (!fallbackUrl || !isHttpUrl(fallbackUrl)) return false;

  const port = input.port || defaultChatWithOpenPlatformPort;
  try {
    const opened = await port.openPlatform(platformId, fallbackUrl);
    return Boolean(opened);
  } catch (_e) {
    return false;
  }
}
