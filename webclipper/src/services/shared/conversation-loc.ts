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

const conversationLocApi = {
  encodeConversationLoc,
  decodeConversationLoc,
  buildConversationLoc,
  buildConversationRouteFromLoc,
};

export default conversationLocApi;
