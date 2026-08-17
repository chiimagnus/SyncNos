import type { PlainSnippetHighlight } from '@services/local-data/contracts';

export type SearchHighlightSegment = Readonly<{ highlighted: boolean; text: string }>;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return offset >= 0 && offset <= text.length;
  return !(isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset)));
}

/** Invalid/overlapping UTF-16 offsets deliberately fall back to plain text. */
export function splitSearchSnippetHighlights(
  textValue: unknown,
  highlights: readonly PlainSnippetHighlight[] | null | undefined,
): readonly SearchHighlightSegment[] {
  const text = String(textValue ?? '');
  if (!Array.isArray(highlights) || !highlights.length) return Object.freeze([{ highlighted: false, text }]);

  let cursor = 0;
  const out: SearchHighlightSegment[] = [];
  for (const range of highlights) {
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < cursor ||
      start < 0 ||
      end <= start ||
      end > text.length ||
      !isUtf16Boundary(text, start) ||
      !isUtf16Boundary(text, end)
    ) {
      return Object.freeze([{ highlighted: false, text }]);
    }
    if (start > cursor) out.push(Object.freeze({ highlighted: false, text: text.slice(cursor, start) }));
    out.push(Object.freeze({ highlighted: true, text: text.slice(start, end) }));
    cursor = end;
  }
  if (cursor < text.length) out.push(Object.freeze({ highlighted: false, text: text.slice(cursor) }));
  return Object.freeze(out);
}
