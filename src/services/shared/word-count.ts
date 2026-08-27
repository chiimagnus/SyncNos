import { resolveConversationMessageTextSource } from '@services/conversations/domain/message-text-source';

function normalizeText(text: unknown): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function countWords(text: string): number {
  const value = normalizeText(text);
  if (!value) return 0;

  try {
    const Segmenter = (Intl as any)?.Segmenter;
    if (typeof Segmenter === 'function') {
      const segmenter = new Segmenter(undefined, { granularity: 'word' });
      let count = 0;
      for (const token of segmenter.segment(value)) {
        if (token && token.isWordLike) count += 1;
      }
      if (count > 0) return count;
    }
  } catch (_e) {
    // ignore and fallback
  }

  return value.split(/\s+/).filter(Boolean).length;
}

export function countWordsFromMessages(
  messages: Array<{ contentText?: string | null; contentMarkdown?: string | null }>,
): number {
  const parts: string[] = [];
  for (const message of messages || []) {
    const source = resolveConversationMessageTextSource(message);
    if (source.kind !== 'empty') parts.push(source.value);
  }
  if (!parts.length) return 0;
  return countWords(parts.join('\n'));
}
