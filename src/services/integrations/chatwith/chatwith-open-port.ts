import { openExternalUrl } from '@services/integrations/open-external-url';
import type { ChatWithAiPlatform } from '@services/integrations/chatwith/chatwith-settings';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';

export type ChatWithOpenPlatformPort = {
  openPlatform: (platformId: string, fallbackUrl?: string | null) => Promise<boolean>;
};

function safeText(value: unknown): string {
  return String(value || '').trim();
}

export const defaultChatWithOpenPlatformPort: ChatWithOpenPlatformPort = {
  async openPlatform(_platformId, fallbackUrl) {
    const href = sanitizeHttpUrl(fallbackUrl);
    if (!href) return false;
    return openExternalUrl(href);
  },
};

export async function openChatWithPlatform(input: {
  platform: ChatWithAiPlatform;
  port?: ChatWithOpenPlatformPort | null;
}): Promise<boolean> {
  const platform = input.platform;
  const platformId = safeText(platform?.id);
  const fallbackUrl = sanitizeHttpUrl(platform?.url);
  if (!platformId || !fallbackUrl) return false;

  const port = input.port || defaultChatWithOpenPlatformPort;
  return Boolean(await port.openPlatform(platformId, fallbackUrl));
}
