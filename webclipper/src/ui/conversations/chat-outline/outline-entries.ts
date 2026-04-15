import type { ConversationMessage } from '@services/conversations/domain/models';

export type ChatOutlineEntry = {
  index: number;
  messageId: number;
  messageKey: string;
  previewText: string;
};

const DEFAULT_PREVIEW_MAX_LEN = 30;
const ELLIPSIS = '…';

function normalizeSingleLine(text: string): string {
  return String(text || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toValidMaxLen(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PREVIEW_MAX_LEN;
  return Math.max(1, Math.floor(parsed));
}

function truncatePreview(text: string, maxLen: number): string {
  const normalized = normalizeSingleLine(text);
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}${ELLIPSIS}`;
}

function markdownToReadableText(markdown: string): string {
  const raw = String(markdown || '');
  if (!raw) return '';

  const withoutFences = raw
    .replace(/```+/g, ' ')
    .replace(/~~~+/g, ' ')
    .replace(/^#{1,6}\s+/gm, ' ')
    .replace(/^\s*>\s?/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ')
    .replace(/!\[([^\]]*)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:^|\s)https?:\/\/\S+/gi, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_~]+/g, ' ');

  return normalizeSingleLine(withoutFences);
}

export function extractMessagePlainText(message: ConversationMessage): string {
  const contentText = normalizeSingleLine(String(message?.contentText || ''));
  if (contentText) return contentText;
  return markdownToReadableText(String(message?.contentMarkdown || ''));
}

export function buildChatOutlineEntries(
  messages: ConversationMessage[],
  options?: { maxLen?: number },
): ChatOutlineEntry[] {
  if (!Array.isArray(messages) || !messages.length) return [];
  const maxLen = toValidMaxLen(options?.maxLen);
  const entries: ChatOutlineEntry[] = [];

  for (const message of messages) {
    const role = String(message?.role || '')
      .trim()
      .toLowerCase();
    if (role !== 'user') continue;

    const index = entries.length + 1;
    const rawMessageId = Number(message?.id);
    const messageId = Number.isFinite(rawMessageId) && rawMessageId !== 0 ? Math.trunc(rawMessageId) : -index;
    const rawMessageKey = String(message?.messageKey || '').trim();
    const messageKey = rawMessageKey || `outline-${index}`;

    entries.push({
      index,
      messageId,
      messageKey,
      previewText: truncatePreview(extractMessagePlainText(message), maxLen),
    });
  }

  return entries;
}
