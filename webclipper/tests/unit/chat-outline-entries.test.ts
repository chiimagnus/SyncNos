import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../../src/services/conversations/domain/models';
import { buildChatOutlineEntries } from '../../src/ui/conversations/chat-outline/outline-entries';

function msg(input: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: 1,
    conversationId: 1,
    messageKey: 'message-1',
    role: 'assistant',
    contentText: '',
    contentMarkdown: '',
    ...input,
  };
}

describe('buildChatOutlineEntries', () => {
  it('keeps only user messages in original order and uses 1-based index', () => {
    const entries = buildChatOutlineEntries([
      msg({ id: 100, messageKey: 'assistant', role: 'assistant', contentText: 'skip me' }),
      msg({ id: 101, messageKey: 'u-1', role: 'user', contentText: 'first' }),
      msg({ id: 102, messageKey: 'u-2', role: 'user', contentText: 'second' }),
    ]);

    expect(entries).toEqual([
      { index: 1, messageId: 101, messageKey: 'u-1', previewText: 'first' },
      { index: 2, messageId: 102, messageKey: 'u-2', previewText: 'second' },
    ]);
  });

  it('prefers contentText over contentMarkdown', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 201,
        messageKey: 'u-201',
        role: 'user',
        contentText: 'from contentText',
        contentMarkdown: '# from contentMarkdown',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('from contentText');
  });

  it('normalizes multiline whitespace to a single line', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 301,
        messageKey: 'u-301',
        role: 'user',
        contentText: 'line 1\n\nline 2\tline 3',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('line 1 line 2 line 3');
  });

  it('truncates strings longer than 30 chars and keeps <=30 unchanged', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 401,
        messageKey: 'u-401',
        role: 'user',
        contentText: '123456789012345678901234567890',
      }),
      msg({
        id: 402,
        messageKey: 'u-402',
        role: 'user',
        contentText: '12345678901234567890123456789012345',
      }),
    ]);

    expect(entries[0]?.previewText).toBe('123456789012345678901234567890');
    expect(entries[1]?.previewText).toBe('123456789012345678901234567890…');
  });

  it('still creates entries with empty or missing content fields', () => {
    const entries = buildChatOutlineEntries([
      msg({
        id: 501,
        messageKey: 'u-501',
        role: 'user',
        contentText: '',
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
