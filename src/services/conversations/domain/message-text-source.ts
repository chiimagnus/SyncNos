import type { ConversationMessage } from '@services/conversations/domain/models';

export type ConversationMessageTextSource =
  | { kind: 'text'; value: string }
  | { kind: 'markdown'; value: string }
  | { kind: 'empty'; value: '' };

type MessageTextFields = Pick<ConversationMessage, 'contentText' | 'contentMarkdown'>;

function normalizeLineEndings(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function resolveConversationMessageTextSource(message: MessageTextFields): ConversationMessageTextSource {
  const contentText = normalizeLineEndings(message?.contentText);
  if (contentText.trim()) return { kind: 'text', value: contentText };

  const contentMarkdown = normalizeLineEndings(message?.contentMarkdown);
  if (contentMarkdown.trim()) return { kind: 'markdown', value: contentMarkdown };

  return { kind: 'empty', value: '' };
}
