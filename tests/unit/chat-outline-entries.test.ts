import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../../src/services/conversations/domain/models';
import { buildChatOutlineEntries } from '../../src/ui/conversations/chat-outline/outline-entries';

function msg(input: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 1,
    conversationId: 1,
    messageKey: 'message-1',
    role: 'assistant',
    contentMarkdown: '',
    ...input,
  };
}

describe('buildChatOutlineEntries', () => {
  it('keeps only user messages in original order and uses 1-based index', () => {
    const entries = buildChatOutlineEntries([
      msg({ id: 100, messageKey: 'assistant', role: 'assistant', contentMarkdown: 'skip me' }),
      msg({ id: 101, messageKey: 'u-1', role: 'user', contentMarkdown: 'first' }),
      msg({ id: 102, messageKey: 'u-2', role: 'user', contentMarkdown: 'second' }),
    ]);

    expect(entries).toEqual([
      { index: 1, messageId: 101, messageKey: 'u-1', previewText: 'first' },
      { index: 2, messageId: 102, messageKey: 'u-2', previewText: 'second' },
    ]);
  });

  it('derives preview text from the canonical Markdown body', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 201,
        messageKey: 'u-201',
        role: 'user',
        contentMarkdown: '# from contentMarkdown',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('from contentMarkdown');
  });

  it('normalizes Markdown preview formatting', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 251,
        messageKey: 'u-251',
        role: 'user',
        contentMarkdown: '# Markdown fallback',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('Markdown fallback');
  });

  it('keeps the existing preview-specific image and link semantics for markdown-only messages', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 252,
        messageKey: 'u-252',
        role: 'user',
        contentMarkdown: '![Diagram](https://example.com/image.png) [OpenAI](https://openai.com) https://example.com',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('Diagram OpenAI');
  });

  it('parses nested-parenthesis Markdown destinations without leaking URL punctuation', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 260,
        messageKey: 'u-260',
        role: 'user',
        contentMarkdown: '[Wikipedia](https://en.wikipedia.org/wiki/Function_(mathematics)) next',
      }),
      msg({
        id: 261,
        messageKey: 'u-261',
        role: 'user',
        contentMarkdown: '[nested](https://example.com/a_(b_(c))) tail',
      }),
      msg({
        id: 262,
        messageKey: 'u-262',
        role: 'user',
        contentMarkdown: 'before ![diagram](https://example.com/a_(b).png) after',
      }),
    ]);

    expect(entries.map((entry) => entry.previewText)).toEqual([
      'Wikipedia next',
      'nested tail',
      'before diagram after',
    ]);
  });

  it('normalizes multiline whitespace to a single line', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 301,
        messageKey: 'u-301',
        role: 'user',
        contentMarkdown: 'line 1\n\nline 2\tline 3',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('line 1 line 2 line 3');
  });

  it('keeps long preview text intact so the UI can clamp by lines', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 401,
        messageKey: 'u-401',
        role: 'user',
        contentMarkdown: '123456789012345678901234567890',
      }),
      msg({
        id: 402,
        messageKey: 'u-402',
        role: 'user',
        contentMarkdown: '12345678901234567890123456789012345',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('123456789012345678901234567890');
    expect(entries[1]?.previewText).toBe('12345678901234567890123456789012345');
  });

  it('still creates entries with empty or missing content fields', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 501,
        messageKey: 'u-501',
        role: 'user',
        contentMarkdown: '',
      }),
      {
        id: 502,
        conversationId: 1,
        messageKey: 'u-502',
        role: 'user',
      } as ConversationMessage,
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.previewText).toBe('');
    expect(entries[1]?.previewText).toBe('');
  });
});
