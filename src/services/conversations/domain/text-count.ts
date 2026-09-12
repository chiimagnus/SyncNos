import { markdownToSemanticText, stripHttpUrlsFromText } from '@services/shared/markdown-semantic-text';

const LETTER_OR_NUMBER_RE = /[\p{L}\p{N}]/u;
const MARK_RE = /\p{M}/u;
const EAST_ASIAN_SCRIPT_RE =
  /(?:\p{Script_Extensions=Han}|\p{Script_Extensions=Hiragana}|\p{Script_Extensions=Katakana}|\p{Script_Extensions=Hangul})/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const KEYCAP_BASE_RE = /^[0-9#*]$/u;
const INTERNAL_CONNECTORS = new Set(["'", '’', '-', '_', '.', ':', '+', '@']);
type CountableMessage = {
  messageKey?: string | null;
  contentMarkdown?: string | null;
};

const VIDEO_TIMESTAMP_PREFIX_RE =
  /^\s*(?:\[(?:\d{2}:)?\d{2}:\d{2}(?:\.\d{1,3})?(?:\s+→\s+(?:\d{2}:)?\d{2}:\d{2}(?:\.\d{1,3})?)?\]|(?:\d{2}:)?\d{2}:\d{2})\s+/gm;

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

export function countTextUnits(text: string): number {
  const normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .normalize('NFC');
  if (!normalized.trim()) return 0;
  return countLexicalUnits(stripHttpUrlsFromText(normalized));
}

export function countConversationMessageTextUnits(messages: CountableMessage[]): number {
  let total = 0;
  for (const message of messages || []) {
    const markdown = String(message?.contentMarkdown ?? '');
    if (!markdown.trim()) continue;
    let semanticText = markdownToSemanticText(markdown);
    if (String(message?.messageKey || '') === 'video_transcript') {
      semanticText = semanticText.replace(VIDEO_TIMESTAMP_PREFIX_RE, '');
    }
    total += countTextUnits(semanticText);
  }
  return total;
}
