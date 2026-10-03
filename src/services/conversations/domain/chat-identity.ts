import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';

function normalizeSource(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function parseUrl(value: unknown): URL | null {
  try {
    return new URL(String(value || '').trim());
  } catch (_error) {
    return null;
  }
}

function hostMatches(hostname: string, base: string): boolean {
  return hostname === base || hostname.endsWith(`.${base}`);
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch (_error) {
    return value.trim();
  }
}

function pathId(pathname: string, pattern: RegExp): string {
  const match = pathname.match(pattern);
  return match?.[1] ? decoded(match[1]) : '';
}

export function canonicalChatIdentityFromUrl(sourceValue: unknown, urlValue: unknown): string {
  const source = normalizeSource(sourceValue);
  const url = parseUrl(urlValue);
  if (!source || !url) return '';

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (source === 'chatgpt') {
    const durable = parseChatgptDurableConversationRoute(url);
    if (durable?.conversationId) return `chatgpt:conversation:${durable.conversationId}`;
    const shareId = pathId(pathname, /^\/share\/([^/?#]+)/);
    return hostname === 'chatgpt.com' && shareId ? `chatgpt:share:${shareId}` : '';
  }

  if (source === 'claude' && hostMatches(hostname, 'claude.ai')) {
    const id = pathId(pathname, /^\/chat\/([^/?#]+)\/?$/);
    return id ? `claude:${id}` : '';
  }

  if (source === 'gemini' && hostname === 'gemini.google.com') {
    const appId = pathId(pathname, /^\/app\/([^/?#]+)\/?$/);
    if (appId) return `gemini:${appId}`;
    const gemMatch = pathname.match(/^\/gem\/[^/?#]+\/([^/?#]+)\/?$/);
    const gemConversationId = gemMatch?.[1] ? decoded(gemMatch[1]) : '';
    return gemConversationId ? `gemini:${gemConversationId}` : '';
  }

  if (source === 'googleaistudio' && (hostname === 'aistudio.google.com' || hostname === 'makersuite.google.com')) {
    const id = pathId(pathname, /^\/(?:app\/)?(?:u\/\d+\/)?prompts\/([^/?#]+)(?:\/|$)/);
    if (!id || new Set(['new_chat', 'new_comparison', 'new_image', 'new_video', 'new_music']).has(id)) return '';
    return `googleaistudio:${id}`;
  }

  if (source === 'deepseek' && hostname === 'chat.deepseek.com') {
    const id = pathId(pathname, /^\/a\/chat\/s\/([^/?#]+)/);
    return id ? `deepseek:${id}` : '';
  }

  if (source === 'kimi' && (hostMatches(hostname, 'kimi.com') || hostMatches(hostname, 'kimi.moonshot.cn'))) {
    const id = pathId(pathname, /^\/chat\/([^/?#]+)/);
    return id ? `kimi:${id}` : '';
  }

  if (source === 'doubao' && hostMatches(hostname, 'doubao.com')) {
    const id = pathId(pathname, /^\/chat\/([^/?#]+)/);
    return id ? `doubao:${id}` : '';
  }

  if (source === 'yuanbao' && hostname === 'yuanbao.tencent.com') {
    const match = pathname.match(/^\/chat\/[^/?#]+\/([^/?#]+)/);
    const id = match?.[1] ? decoded(match[1]) : '';
    return id ? `yuanbao:${id}` : '';
  }

  if (source === 'poe' && hostMatches(hostname, 'poe.com')) {
    const id = pathId(pathname, /^\/chat\/([^/?#]+)/);
    return id ? `poe:${id}` : '';
  }

  if (source === 'notionai' && (hostMatches(hostname, 'notion.so') || hostMatches(hostname, 'app.notion.com'))) {
    if (pathname !== '/chat') return '';
    const threadId = String(url.searchParams.get('t') || '')
      .trim()
      .toLowerCase();
    return threadId ? `notionai:${threadId}` : '';
  }

  if (source === 'zai' && hostname === 'chat.z.ai') {
    const id = pathId(pathname, /^\/c\/([^/?#]+)/);
    return id ? `zai:${id}` : '';
  }

  return '';
}

export function canonicalChatUrlFromUrl(sourceValue: unknown, urlValue: unknown): string {
  const source = normalizeSource(sourceValue);
  const url = parseUrl(urlValue);
  if (!source || !url || !canonicalChatIdentityFromUrl(source, url)) return '';

  const canonicalOrigins: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    googleaistudio: 'https://aistudio.google.com',
    deepseek: 'https://chat.deepseek.com',
    kimi: 'https://www.kimi.com',
    doubao: 'https://www.doubao.com',
    yuanbao: 'https://yuanbao.tencent.com',
    poe: 'https://poe.com',
    notionai: 'https://app.notion.com',
    zai: 'https://chat.z.ai',
  };
  const origin = canonicalOrigins[source] || url.origin;
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (source === 'notionai') {
    const threadId = String(url.searchParams.get('t') || '').trim();
    return threadId ? `${origin}/chat?t=${encodeURIComponent(threadId)}` : '';
  }

  return `${origin}${pathname}`;
}
