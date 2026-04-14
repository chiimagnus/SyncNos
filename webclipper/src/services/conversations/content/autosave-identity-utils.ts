import normalizeApi from '@services/shared/normalize.ts';

export const IDENTITY_PREFIX_LEN = 96;
export const MIN_OVERLAP_FOR_LONG_WINDOWS = 8;

export function normalizeContent(value: unknown): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.normalizeText === 'function') {
    return normalize.normalizeText(value);
  }
  return String(value || '');
}

export function getMessageIdentityBase(
  message: any,
  identityPrefixLen: number = IDENTITY_PREFIX_LEN,
): { role: string; base: string; text: string; markdown: string } {
  const role = String((message && message.role) || 'assistant').trim() || 'assistant';
  const text = normalizeContent(message && message.contentText);
  const markdownRaw =
    message && message.contentMarkdown && String(message.contentMarkdown).trim() ? String(message.contentMarkdown) : '';
  const markdown = markdownRaw ? normalizeContent(markdownRaw) : '';
  const full = text || markdown;
  const clipped = full ? full.slice(0, identityPrefixLen) : '';
  const base = `${role}|${clipped}`;
  return { role, base, text, markdown };
}

export function fingerprintHash(base: string): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(base));
  return base;
}

export function getMessageIdentityMeta(
  message: any,
  identityPrefixLen: number = IDENTITY_PREFIX_LEN,
): { role: string; text: string; markdown: string; base: string; identityHash: string } {
  const { role, text, markdown, base } = getMessageIdentityBase(message, identityPrefixLen);
  return {
    role,
    text,
    markdown,
    base,
    identityHash: fingerprintHash(base),
  };
}

export function computeRequiredOverlap(leftLength: number, rightLength: number): number {
  const overlapBasis = Math.min(leftLength, rightLength);
  if (overlapBasis <= 2) return overlapBasis;
  return Math.min(MIN_OVERLAP_FOR_LONG_WINDOWS, Math.max(2, Math.floor(overlapBasis * 0.6)));
}

export function computeSuffixPrefixOverlap(prev: string[], cur: string[], requiredOverlap: number): number {
  const prevLen = prev.length;
  const curLen = cur.length;
  const maxOverlap = Math.min(prevLen, curLen);
  if (maxOverlap <= 0) return 0;

  for (let overlap = maxOverlap; overlap >= requiredOverlap; overlap -= 1) {
    const start = prevLen - overlap;
    let ok = true;
    for (let i = 0; i < overlap; i += 1) {
      if (prev[start + i] !== cur[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return overlap;
  }
  return 0;
}

