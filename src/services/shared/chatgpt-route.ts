export const CHATGPT_HOSTNAME = 'chatgpt.com';
export const CHATGPT_ORIGIN = 'https://chatgpt.com';

export function isCanonicalChatgptHostname(value: unknown): boolean {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === CHATGPT_HOSTNAME
  );
}

export function isCanonicalChatgptOrigin(value: unknown): boolean {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === CHATGPT_ORIGIN
  );
}

export function parseChatgptDurableConversationRoute(urlLike: unknown): { conversationId: string } | null {
  let url: URL;
  try {
    url = urlLike instanceof URL ? urlLike : new URL(String(urlLike || ''));
  } catch (_error) {
    return null;
  }
  if (!isCanonicalChatgptOrigin(url.origin)) return null;

  const direct = url.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (direct?.[1]) return { conversationId: direct[1] };

  const project = url.pathname.match(/^\/g\/[^/]+\/c\/([^/]+)\/?$/);
  return project?.[1] ? { conversationId: project[1] } : null;
}
