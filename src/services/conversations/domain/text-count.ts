import MarkdownIt from 'markdown-it';

import { resolveConversationMessageTextSource } from '@services/conversations/domain/message-text-source';

const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const MARK_RE = /\p{M}/u;
const EAST_ASIAN_SCRIPT_RE =
  /(?:\p{Script_Extensions=Han}|\p{Script_Extensions=Hiragana}|\p{Script_Extensions=Katakana}|\p{Script_Extensions=Hangul})/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE_RE = /^[0-9#*]$/u;
const INTERNAL_CONNECTORS = new Set(["'", '’', '-', '_', '.', ':', '+', '@']);
const URL_HARD_TERMINATORS = new Set([
  '<',
  '>',
  '"',
  "'",
  '`',
  '{',
  '}',
  ',',
  ';',
  '!',
  '|',
  '，',
  '。',
  '！',
  '？',
  '；',
  '：',
  '、',
  '（',
  '）',
  '【',
  '】',
  '《',
  '》',
  '〈',
  '〉',
  '「',
  '」',
  '『',
  '』',
  '“',
  '”',
  '‘',
  '’',
  '…',
  '—',
]);

const markdownParser = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});
markdownParser.enable(['table']);

type CountableMessage = {
  contentText?: string | null;
  contentMarkdown?: string | null;
};

type MarkdownToken = {
  type: string;
  content: string;
  children: MarkdownToken[] | null;
};

function codePointAt(text: string, index: number): string {
  const value = text.codePointAt(index);
  return value == null ? '' : String.fromCodePoint(value);
}

function httpSchemeLengthAt(text: string, index: number): number {
  const candidate = text.slice(index, index + 8).toLowerCase();
  if (candidate.startsWith('https://')) return 8;
  if (candidate.startsWith('http://')) return 7;
  return 0;
}

function isUrlTerminator(char: string): boolean {
  return !char || /\s/u.test(char) || URL_HARD_TERMINATORS.has(char);
}

function httpUrlSpanEnd(text: string, start: number, schemeLength: number): number {
  let end = start + schemeLength;
  let parenDepth = 0;
  let bracketDepth = 0;

  while (end < text.length) {
    const char = codePointAt(text, end);
    if (isUrlTerminator(char)) break;

    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      if (parenDepth === 0) break;
      parenDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      if (bracketDepth === 0) break;
      bracketDepth -= 1;
    }

    end += char.length || 1;
  }

  return end;
}

function stripHttpUrlSpans(text: string): string {
  let output = '';
  let index = 0;

  while (index < text.length) {
    const schemeLength = httpSchemeLengthAt(text, index);
    if (!schemeLength) {
      const char = codePointAt(text, index);
      output += char;
      index += char.length || 1;
      continue;
    }

    output += ' ';
    index = httpUrlSpanEnd(text, index, schemeLength);
  }

  return output;
}

function isEastAsianCountChar(char: string): boolean {
  return LETTER_OR_NUMBER_RE.test(char) && EAST_ASIAN_SCRIPT_RE.test(char);
}

function isNonEastCoreChar(char: string): boolean {
  return LETTER_OR_NUMBER_RE.test(char) && !isEastAsianCountChar(char);
}

function keycapSequenceLength(chars: string[], index: number): number {
  if (!KEYCAP_BASE_RE.test(chars[index] || '')) return 0;
  if (chars[index + 1] === '\u20e3') return 2;
  if (chars[index + 1] === '\ufe0f' && chars[index + 2] === '\u20e3') return 3;
  return 0;
}

function countLexicalUnits(text: string): number {
  const chars = Array.from(text);
  let count = 0;
  let inNonEastToken = false;

  for (let index = 0; index < chars.length; index += 1) {
    const keycapLength = keycapSequenceLength(chars, index);
    if (keycapLength) {
      inNonEastToken = false;
      index += keycapLength - 1;
      continue;
    }

    const char = chars[index] || '';
    if (EXTENDED_PICTOGRAPHIC_RE.test(char)) {
      inNonEastToken = false;
      continue;
    }

    if (isEastAsianCountChar(char)) {
      count += 1;
      inNonEastToken = false;
      continue;
    }

    if (isNonEastCoreChar(char)) {
      if (!inNonEastToken) count += 1;
      inNonEastToken = true;
      continue;
    }

    if (MARK_RE.test(char)) {
      continue;
    }

    if (INTERNAL_CONNECTORS.has(char) && inNonEastToken && isNonEastCoreChar(chars[index + 1] || '')) {
      continue;
    }

    inNonEastToken = false;
  }

  return count;
}

function appendMarkdownTokenText(tokens: readonly MarkdownToken[], parts: string[]): void {
  for (const token of tokens) {
    if (token.type === 'image') {
      parts.push(' ');
      continue;
    }

    if (token.type === 'inline') {
      if (token.children?.length) appendMarkdownTokenText(token.children, parts);
      parts.push('\n');
      continue;
    }

    if (token.type === 'text' || token.type === 'code_inline') {
      parts.push(token.content);
      continue;
    }

    if (token.type === 'code_block' || token.type === 'fence') {
      parts.push(token.content, '\n');
      continue;
    }

    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      parts.push('\n');
      continue;
    }

    if (token.children?.length) appendMarkdownTokenText(token.children, parts);
  }
}

function markdownToSemanticText(markdown: string): string {
  const parts: string[] = [];
  appendMarkdownTokenText(markdownParser.parse(markdown, {}) as MarkdownToken[], parts);
  return parts.join('');
}

export function countTextUnits(text: string): number {
  const normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .normalize('NFC');
  if (!normalized.trim()) return 0;
  return countLexicalUnits(stripHttpUrlSpans(normalized));
}

export function countConversationMessageTextUnits(messages: CountableMessage[]): number {
  let total = 0;
  for (const message of messages || []) {
    const source = resolveConversationMessageTextSource(message);
    if (source.kind === 'text') {
      total += countTextUnits(source.value);
      continue;
    }
    if (source.kind === 'markdown') total += countTextUnits(markdownToSemanticText(source.value));
  }
  return total;
}
