import type { ConversationMessage } from '@services/conversations/domain/models';
import { markdownToSemanticText, stripHttpUrlsFromText } from '@services/shared/markdown-semantic-text';

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

export function extractMessagePlainText(message: ConversationMessage): string {
  const semanticText = markdownToSemanticText(message?.contentMarkdown, { includeImageAlt: true });
  return normalizeSingleLine(stripHttpUrlsFromText(semanticText));
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
