import { normalizeDilMarkdown } from '@services/shared/dil-markdown';
import { markdownToSemanticText, stripHttpUrlsFromText } from '@services/shared/markdown-semantic-text';
import { splitThinkingMarkdown } from '@services/shared/thinking-markdown';

const MAX_PREVIEW_LENGTH = 64;
const MAX_PREVIEW_INPUT_LENGTH = 8192;

type ChatHeadingMessage = {
  role?: unknown;
  authorName?: unknown;
  sequence?: unknown;
  contentMarkdown?: unknown;
};

function messagePreview(contentMarkdown: unknown): string {
  const raw = String(contentMarkdown ?? '');
  const answer = splitThinkingMarkdown(raw)?.answer ?? raw;
  const normalized = normalizeDilMarkdown(answer.slice(0, MAX_PREVIEW_INPUT_LENGTH));
  const plain = stripHttpUrlsFromText(markdownToSemanticText(normalized, { includeImageAlt: true }))
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!plain) return '';
  const end = /[。！？!?]|\.(?=\s|$)/u.exec(plain);
  const sentence = end ? plain.slice(0, end.index + end[0].length) : plain;
  const characters = Array.from(sentence);
  if (characters.length <= MAX_PREVIEW_LENGTH) return sentence;
  return `${characters.slice(0, MAX_PREVIEW_LENGTH).join('').trimEnd()}…`;
}

export function formatChatMessageHeading(message: ChatHeadingMessage, fallbackIndex = 0): string {
  const sequence = message?.sequence == null ? NaN : Number(message.sequence);
  const number = Number.isSafeInteger(sequence) && sequence >= 0 ? sequence + 1 : fallbackIndex + 1;
  const index = String(number).padStart(2, '0');
  const role = String(message?.role || 'assistant')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  const authorName = Array.from(
    String(message?.authorName || '')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, 80)
    .join('');
  const label = role === 'user' ? authorName || 'You' : role === 'assistant' ? 'Assistant' : role || 'Assistant';
  const preview = messagePreview(message?.contentMarkdown);
  return `${index} · ${label}${preview ? ` — ${preview}` : ''}`;
}

export function escapeMarkdownHeading(value: string): string {
  return value.replace(/[\\`*_\[\]<>]/gu, '\\$&');
}
