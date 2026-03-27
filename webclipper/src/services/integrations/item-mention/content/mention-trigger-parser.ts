export type MentionTriggerMatch = {
  triggerStart: number;
  triggerEnd: number;
  query: string;
};

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

export function parseMentionTrigger(input: { text: string; cursor: number }): MentionTriggerMatch | null {
  const text = String(input.text || '');
  const cursor = Number(input.cursor);
  if (!Number.isFinite(cursor)) return null;
  if (cursor < 0 || cursor > text.length) return null;

  // Find the nearest `$` before (or at) the cursor, and treat the segment `$...<cursor>` as the active trigger.
  const start = text.lastIndexOf('$', Math.max(0, cursor - 1));
  if (start < 0) return null;

  const query = text.slice(start + 1, cursor);
  for (let i = 0; i < query.length; i += 1) {
    if (isWhitespace(query[i]!)) return null;
  }

  return {
    triggerStart: start,
    triggerEnd: cursor,
    query,
  };
}
