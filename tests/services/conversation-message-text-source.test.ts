import { describe, expect, it } from 'vitest';

import { resolveConversationMessageTextSource } from '@services/conversations/domain/message-text-source';

describe('resolveConversationMessageTextSource', () => {
  it('prefers non-empty contentText without rewriting its semantic text', () => {
    expect(
      resolveConversationMessageTextSource({
        contentText: '你好\r\nworld',
        contentMarkdown: '00:01 **different**',
      }),
    ).toEqual({ kind: 'text', value: '你好\nworld' });
  });

  it('falls back to contentMarkdown when contentText is whitespace-only', () => {
    expect(
      resolveConversationMessageTextSource({
        contentText: ' \t\r\n ',
        contentMarkdown: '# Heading\r\nbody',
      }),
    ).toEqual({ kind: 'markdown', value: '# Heading\nbody' });
  });

  it('supports markdown-only legacy messages', () => {
    expect(resolveConversationMessageTextSource({ contentMarkdown: '**legacy**' })).toEqual({
      kind: 'markdown',
      value: '**legacy**',
    });
  });

  it('returns empty when both sources are missing or blank', () => {
    expect(resolveConversationMessageTextSource({})).toEqual({ kind: 'empty', value: '' });
    expect(resolveConversationMessageTextSource({ contentText: '  ', contentMarkdown: '\n\t' })).toEqual({
      kind: 'empty',
      value: '',
    });
  });

  it('normalizes CRLF and CR without changing source precedence', () => {
    expect(resolveConversationMessageTextSource({ contentText: 'a\rb\r\nc', contentMarkdown: 'ignored' })).toEqual({
      kind: 'text',
      value: 'a\nb\nc',
    });
  });

  it('preserves Markdown indentation and blank lines for downstream parsing', () => {
    const markdown = '    indented code\r\n\r\n- outer\r\n  - nested\r\n';
    expect(resolveConversationMessageTextSource({ contentText: '', contentMarkdown: markdown })).toEqual({
      kind: 'markdown',
      value: '    indented code\n\n- outer\n  - nested\n',
    });
  });
});
