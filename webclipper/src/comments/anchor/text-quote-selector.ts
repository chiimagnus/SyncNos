export type TextQuoteSelector = {
  exact: string;
  prefix?: string;
  suffix?: string;
};

export function normalizeTextQuoteSelector(input: unknown): TextQuoteSelector | null {
  const selector = input && typeof input === 'object' ? (input as any) : null;
  const exact = String(selector?.exact || '').trim();
  if (!exact) return null;
  const prefix = selector?.prefix != null ? String(selector.prefix) : '';
  const suffix = selector?.suffix != null ? String(selector.suffix) : '';
  return {
    exact,
    ...(prefix ? { prefix } : null),
    ...(suffix ? { suffix } : null),
  };
}

export type TextQuoteMatch = { start: number; end: number };

export function findTextQuoteInText(text: string, selectorInput: TextQuoteSelector | null): TextQuoteMatch | null {
  const selector = normalizeTextQuoteSelector(selectorInput);
  const haystack = String(text || '');
  if (!selector || !haystack) return null;

  const exact = selector.exact;
  const hits: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= haystack.length) {
    const idx = haystack.indexOf(exact, fromIndex);
    if (idx < 0) break;
    hits.push(idx);
    fromIndex = idx + Math.max(1, exact.length);
  }
  if (!hits.length) return null;
  if (hits.length === 1) return { start: hits[0], end: hits[0] + exact.length };

  const prefix = selector.prefix || '';
  const suffix = selector.suffix || '';
  if (!prefix && !suffix) return { start: hits[0], end: hits[0] + exact.length };

  const narrowed = hits.filter((idx) => {
    if (prefix) {
      const left = haystack.slice(Math.max(0, idx - prefix.length), idx);
      if (left !== prefix) return false;
    }
    if (suffix) {
      const right = haystack.slice(idx + exact.length, idx + exact.length + suffix.length);
      if (right !== suffix) return false;
    }
    return true;
  });

  const chosen = narrowed.length ? narrowed[0] : hits[0];
  return { start: chosen, end: chosen + exact.length };
}
