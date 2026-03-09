export function normalizeText(text: unknown): string {
  const value = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = value.split('\n').map((line) => line.trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function fnv1a32(text: unknown): string {
  let hash = 0x811c9dc5;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return (`0000000${hash.toString(16)}`).slice(-8);
}

export function makeFallbackMessageKey(input: {
  role?: unknown;
  contentText?: unknown;
  sequence?: unknown;
}): string {
  const base = `${input?.role || 'assistant'}|${input?.sequence || 0}|${normalizeText(input?.contentText)}`;
  return `fallback_${fnv1a32(base)}`;
}

const normalizeApi = {
  normalizeText,
  fnv1a32,
  makeFallbackMessageKey,
};

export default normalizeApi;
