function normalizeSource(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeConversationKey(value: string): string {
  return String(value || '').trim();
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(bytes).toString('base64')
      : btoa(
          Array.from(bytes)
            .map((byte) => String.fromCharCode(byte))
            .join(''),
        );
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  if (trimmed.length % 4 === 1) return null;

  const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  try {
    if (typeof Buffer !== 'undefined') {
      const bytes = new Uint8Array(Buffer.from(padded, 'base64'));
      return new TextDecoder().decode(bytes);
    }

    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let index = 0; index < bin.length; index += 1) {
      bytes[index] = bin.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeConversationLoc(input: { source: string; conversationKey: string }): string {
  const source = normalizeSource(input?.source);
  const conversationKey = normalizeConversationKey(input?.conversationKey);
  return encodeBase64Url(`${source}||${conversationKey}`);
}

export function decodeConversationLoc(loc: unknown): { source: string; conversationKey: string } | null {
  if (typeof loc !== 'string') return null;
  const payload = decodeBase64Url(loc);
  if (!payload) return null;

  const delimiterIndex = payload.indexOf('||');
  if (delimiterIndex <= 0) return null;

  const source = normalizeSource(payload.slice(0, delimiterIndex));
  const conversationKey = normalizeConversationKey(payload.slice(delimiterIndex + 2));
  if (!source || !conversationKey) return null;

  return { source, conversationKey };
}

export function buildConversationLoc(source: string, conversationKey: string): string {
  return encodeConversationLoc({ source, conversationKey });
}

export function buildConversationRouteFromLoc(loc: string): string {
  return `/?loc=${encodeURIComponent(String(loc || '').trim())}`;
}

const SYNCNOS_LINK_ORIGIN = 'https://chiimagnus.github.io';
const SYNCNOS_LINK_PATH = '/SyncNos/';

export function isSyncnosLinkPage(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.origin === SYNCNOS_LINK_ORIGIN && url.pathname === SYNCNOS_LINK_PATH && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function findLinkedMessageIndex(
  hash: string,
  identity: { source: string; conversationKey: string },
  messages: readonly { messageKey: string }[],
): number {
  if (!hash.startsWith('#/')) return -1;
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) return -1;
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  const messageKey = params.get('message');
  const target = decodeConversationLoc(params.get('loc'));
  if (
    !messageKey ||
    !target ||
    target.source !== identity.source ||
    target.conversationKey !== identity.conversationKey
  )
    return -1;
  return messages.findIndex((message) => message.messageKey === messageKey);
}

export function buildSyncnosLink(input: { source: string; conversationKey: string; messageKey?: string }): string {
  const loc = encodeConversationLoc(input);
  const params = new URLSearchParams({ loc });
  if (input.messageKey) params.set('message', input.messageKey);
  return `${SYNCNOS_LINK_ORIGIN}${SYNCNOS_LINK_PATH}#/open?${params}`;
}

export function parseSyncnosLink(value: unknown): { route: string; messageKey: string | null } | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!isSyncnosLinkPage(url.href) || url.search) return null;
  if (!url.hash.startsWith('#/open?')) return null;
  const params = new URLSearchParams(url.hash.slice('#/open?'.length));
  const locs = params.getAll('loc');
  const messages = params.getAll('message');
  if (
    locs.length !== 1 ||
    locs[0]!.length > 4096 ||
    !decodeConversationLoc(locs[0]) ||
    messages.length > 1 ||
    [...params.keys()].some((key) => key !== 'loc' && key !== 'message')
  )
    return null;
  const messageKey = messages[0] ?? null;
  if (messageKey != null && (!messageKey || messageKey.length > 512 || /\p{Cc}/u.test(messageKey))) return null;
  const route = buildConversationRouteFromLoc(locs[0]!);
  return { route: messageKey ? `${route}&message=${encodeURIComponent(messageKey)}` : route, messageKey };
}

const conversationLocApi = {
  encodeConversationLoc,
  decodeConversationLoc,
  buildConversationLoc,
  buildConversationRouteFromLoc,
};

export default conversationLocApi;
