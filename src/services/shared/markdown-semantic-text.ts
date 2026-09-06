import MarkdownIt from 'markdown-it';

type MarkdownToken = {
  type: string;
  content: string;
  children: MarkdownToken[] | null;
};

type MarkdownSemanticTextOptions = {
  includeImageAlt?: boolean;
};

const markdownParser = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
});
markdownParser.enable(['table']);

function appendMarkdownTokenText(
  tokens: readonly MarkdownToken[],
  parts: string[],
  options: MarkdownSemanticTextOptions,
): void {
  for (const token of tokens) {
    if (token.type === 'image') {
      if (options.includeImageAlt && token.content) parts.push(token.content);
      parts.push(' ');
      continue;
    }

    if (token.type === 'inline') {
      if (token.children?.length) appendMarkdownTokenText(token.children, parts, options);
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

    if (token.children?.length) appendMarkdownTokenText(token.children, parts, options);
  }
}

export function markdownToSemanticText(markdown: unknown, options: MarkdownSemanticTextOptions = {}): string {
  const source = String(markdown ?? '');
  if (!source) return '';
  const parts: string[] = [];
  appendMarkdownTokenText(markdownParser.parse(source, {}) as MarkdownToken[], parts, options);
  return parts.join('');
}

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

export function stripHttpUrlsFromText(text: unknown): string {
  const source = String(text ?? '');
  let output = '';
  let index = 0;

  while (index < source.length) {
    const schemeLength = httpSchemeLengthAt(source, index);
    if (!schemeLength) {
      const char = codePointAt(source, index);
      output += char;
      index += char.length || 1;
      continue;
    }

    output += ' ';
    index = httpUrlSpanEnd(source, index, schemeLength);
  }

  return output;
}
