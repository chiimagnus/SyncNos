import type { ConversationMessage } from '@services/conversations/domain/models';
import { resolveConversationMessageTextSource } from '@services/conversations/domain/message-text-source';

export type ChatOutlineEntry = {
  index: number;
  messageId: number;
  messageKey: string;
  previewText: string;
};

function normalizeSingleLine(text: string): string {
  return String(text || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const source = resolveConversationMessageTextSource(message);
  if (source.kind === 'text') return normalizeSingleLine(source.value);
  if (source.kind === 'markdown') return markdownToReadableText(source.value);
  return '';
}

export function buildChatOutlineEntries(messages: ConversationMessage[]): ChatOutlineEntry[] {
  if (!Array.isArray(messages) || !messages.length) return [];
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
      previewText: extractMessagePlainText(message),
    });
  }

  return entries;
}
