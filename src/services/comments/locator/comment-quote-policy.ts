const COMMENT_DISPLAY_QUOTE_GRAPHEME_LIMIT = 200;

export function toCanonicalCommentQuote(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function splitGraphemes(value: string): string[] {
  const SegmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string | string[],
        options?: { granularity: 'grapheme' },
      ) => {
        segment(input: string): Iterable<{ segment: string }>;
      };
    }
  ).Segmenter;
  if (typeof SegmenterCtor === 'function') {
    return Array.from(
      new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(value),
      (entry) => entry.segment,
    );
  }
  return Array.from(value);
}

export function toDisplayCommentQuote(value: unknown): string {
  const canonical = toCanonicalCommentQuote(value);
  const graphemes = splitGraphemes(canonical);
  if (graphemes.length <= COMMENT_DISPLAY_QUOTE_GRAPHEME_LIMIT) return canonical;
  return `${graphemes.slice(0, COMMENT_DISPLAY_QUOTE_GRAPHEME_LIMIT).join('')}…`;
}
