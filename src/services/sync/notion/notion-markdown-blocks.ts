import { normalizeStandaloneImageCaptionLines } from '@services/sync/shared/markdown-image-normalizer';
import { isSyncnosAssetUrl } from '@services/shared/syncnos-asset-uri';

const MAX_TEXT = 1900;
const MAX_EQUATION_EXPRESSION = 1900;
const MAX_RICH_TEXT_ITEMS = 100;

function splitText(text: unknown): string[] {
  const s = String(text || '');
  if (s.length <= MAX_TEXT) return [s];
  const parts: string[] = [];
  let remaining = s;
  while (remaining.length) {
    if (remaining.length <= MAX_TEXT) {
      parts.push(remaining);
      break;
    }
    let idx = remaining.lastIndexOf('\n', MAX_TEXT);
    if (idx < 0) idx = MAX_TEXT;
    parts.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).replace(/^\n+/, '');
  }
  return parts;
}

function normalizeCodeLanguage(input: unknown): string {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  if (!raw) return 'plain text';
  const map = new Map([
    ['text', 'plain text'],
    ['plain', 'plain text'],
    ['plaintext', 'plain text'],
    ['plain text', 'plain text'],
    ['js', 'javascript'],
    ['ts', 'typescript'],
    ['py', 'python'],
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['zsh', 'shell'],
    ['c++', 'c++'],
    ['cpp', 'c++'],
    ['rb', 'ruby'],
    ['md', 'markdown'],
  ]);
  const normalized = map.get(raw) || raw;
  const allowed = new Set([
    'plain text',
    'markdown',
    'javascript',
    'typescript',
    'python',
    'shell',
    'json',
    'yaml',
    'html',
    'css',
    'swift',
    'go',
    'rust',
    'java',
    'kotlin',
    'c',
    'c++',
    'c#',
    'php',
    'ruby',
    'sql',
  ]);
  return allowed.has(normalized) ? normalized : 'plain text';
}

function textRich(content: string, { annotations, link }: { annotations?: any; link?: unknown } = {}) {
  const ann = annotations || {};
  const base = {
    bold: !!ann.bold,
    italic: !!ann.italic,
    strikethrough: !!ann.strikethrough,
    underline: !!ann.underline,
    code: !!ann.code,
    color: ann.color || 'default',
  };
  const safeLink = link && /^https?:\/\//i.test(String(link)) ? { url: String(link) } : null;
  const text = safeLink ? { content, link: safeLink } : { content };
  return { type: 'text', text, annotations: base };
}

function normalizeEquationExpression(expression: unknown): string {
  return String(expression || '').trim();
}

function canUseNativeEquation(expression: string): boolean {
  return expression.length <= MAX_EQUATION_EXPRESSION;
}

function inlineEquationFallbackRich(expression: unknown) {
  const expr = normalizeEquationExpression(expression);
  if (!expr) return [];
  return [textRich(`$${expr}$`, { annotations: { code: true } })];
}

function blockEquationFallbackBlocks(expression: unknown) {
  const expr = normalizeEquationExpression(expression);
  if (!expr) return [];
  const literal = `$$\n${expr}\n$$`;
  return splitText(literal)
    .filter((part) => String(part || '').length)
    .map((part) => ({
      object: 'block',
      type: 'code',
      code: {
        rich_text: [textRich(part, { annotations: { code: true } })],
        language: 'plain text',
      },
    }));
}

function equationRich(expression: unknown) {
  const expr = normalizeEquationExpression(expression);
  return { type: 'equation', equation: { expression: expr } };
}

function inlineEquationRich(expression: unknown) {
  const expr = normalizeEquationExpression(expression);
  if (!expr) return [];
  if (canUseNativeEquation(expr)) return [equationRich(expr)];
  return inlineEquationFallbackRich(expr);
}

function mergeRichText(list: any) {
  const out = [];
  for (const item of list || []) {
    if (!item) continue;
    const last = out.length ? out[out.length - 1] : null;
    if (
      last &&
      item.type === 'text' &&
      last.type === 'text' &&
      String((item.text && item.text.link && item.text.link.url) || '') ===
        String((last.text && last.text.link && last.text.link.url) || '') &&
      JSON.stringify(item.annotations || {}) === JSON.stringify(last.annotations || {})
    ) {
      last.text.content =
        String(last.text.content || '') + String(item.text && item.text.content ? item.text.content : '');
    } else {
      out.push(item);
    }
  }
  return out;
}

function chunkRichText(list: any) {
  const chunks: any[] = [];
  let current: any[] = [];
  let currentLen = 0;
  let currentItems = 0;

  function flush() {
    if (!current.length) return;
    chunks.push(current);
    current = [];
    currentLen = 0;
    currentItems = 0;
  }

  for (const item of list || []) {
    if (!item) continue;
    if (item.type !== 'text') {
      if (currentItems >= MAX_RICH_TEXT_ITEMS) flush();
      if (current.length) flush();
      chunks.push([item]);
      continue;
    }
    const content = String(item.text && item.text.content ? item.text.content : '');
    let remaining = content;
    while (remaining.length) {
      if (currentItems >= MAX_RICH_TEXT_ITEMS) flush();
      const budget = Math.max(1, MAX_TEXT - currentLen);
      const take = remaining.slice(0, budget);
      const nextItem = {
        ...item,
        text: item.text && item.text.link ? { content: take, link: item.text.link } : { content: take },
      };
      current.push(nextItem);
      currentLen += take.length;
      currentItems += 1;
      remaining = remaining.slice(take.length);
      if (currentLen >= MAX_TEXT || currentItems >= MAX_RICH_TEXT_ITEMS) flush();
    }
  }
  flush();
  return chunks;
}

type InlineMarkerKind = 'link' | 'equation' | 'bold' | 'strike' | 'italic';

type InlineParseTask =
  | { mode: 'code' | 'plain'; input: string; annotations: any; link?: unknown }
  | { mode: 'emit-code'; content: string; annotations: any; link?: unknown };

function firstInlineMarker(input: string): { kind: InlineMarkerKind; index: number } | null {
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '[') return { kind: 'link', index };
    if (char === '$') return { kind: 'equation', index };
    if (char === '*') return { kind: input[index + 1] === '*' ? 'bold' : 'italic', index };
    if (char === '~' && input[index + 1] === '~') return { kind: 'strike', index };
  }
  return null;
}

function inlineMarkdownToRichText(markdown: unknown) {
  const src = String(markdown || '');
  if (!src) return [];

  const out: any[] = [];
  const stack: InlineParseTask[] = [{ mode: 'code', input: src, annotations: {} }];

  while (stack.length) {
    const task = stack.pop()!;
    if (task.mode === 'emit-code') {
      out.push(
        textRich(task.content, {
          annotations: { ...task.annotations, code: true },
          link: task.link,
        }),
      );
      continue;
    }

    if (!task.input) continue;
    if (task.mode === 'code') {
      const marker = task.input.match(/`+/);
      if (!marker || marker.index === undefined) {
        stack.push({ ...task, mode: 'plain' });
        continue;
      }

      const fence = marker[0];
      const before = task.input.slice(0, marker.index);
      const rest = task.input.slice(marker.index + fence.length);
      const endIndex = rest.indexOf(fence);
      if (endIndex < 0) {
        stack.push({ ...task, mode: 'plain' });
        continue;
      }

      const codeContent = rest.slice(0, endIndex);
      const after = rest.slice(endIndex + fence.length);
      if (after) stack.push({ mode: 'code', input: after, annotations: task.annotations, link: task.link });
      stack.push({ mode: 'emit-code', content: codeContent, annotations: task.annotations, link: task.link });
      if (before) stack.push({ mode: 'plain', input: before, annotations: task.annotations, link: task.link });
      continue;
    }

    const marker = firstInlineMarker(task.input);
    if (!marker) {
      out.push(textRich(task.input, { annotations: task.annotations, link: task.link }));
      continue;
    }

    const before = task.input.slice(0, marker.index);
    const rest = task.input.slice(marker.index);
    if (before) out.push(textRich(before, { annotations: task.annotations, link: task.link }));

    if (marker.kind === 'link') {
      const close = rest.indexOf('](');
      const end = close >= 0 ? rest.indexOf(')', close + 2) : -1;
      if (close >= 0 && end >= 0) {
        const linkText = rest.slice(1, close);
        const url = rest.slice(close + 2, end);
        const tail = rest.slice(end + 1);
        if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
        if (linkText) stack.push({ mode: 'code', input: linkText, annotations: task.annotations, link: url });
        continue;
      }
    } else if (marker.kind === 'equation') {
      if (!rest.startsWith('$$')) {
        const end = rest.indexOf('$', 1);
        if (end > 1) {
          const expression = rest.slice(1, end);
          const tail = rest.slice(end + 1);
          out.push(...inlineEquationRich(expression));
          if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
          continue;
        }
      }
    } else if (marker.kind === 'bold') {
      const end = rest.indexOf('**', 2);
      if (end > 2) {
        const inner = rest.slice(2, end);
        const tail = rest.slice(end + 2);
        if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
        if (inner) {
          stack.push({
            mode: 'plain',
            input: inner,
            annotations: { ...task.annotations, bold: true },
            link: task.link,
          });
        }
        continue;
      }
    } else if (marker.kind === 'strike') {
      const end = rest.indexOf('~~', 2);
      if (end > 2) {
        const inner = rest.slice(2, end);
        const tail = rest.slice(end + 2);
        if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
        if (inner) {
          stack.push({
            mode: 'plain',
            input: inner,
            annotations: { ...task.annotations, strikethrough: true },
            link: task.link,
          });
        }
        continue;
      }
    } else if (!rest.startsWith('**')) {
      const end = rest.indexOf('*', 1);
      if (end > 1) {
        const inner = rest.slice(1, end);
        const tail = rest.slice(end + 1);
        if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
        if (inner) {
          stack.push({
            mode: 'plain',
            input: inner,
            annotations: { ...task.annotations, italic: true },
            link: task.link,
          });
        }
        continue;
      }
    }

    out.push(textRich(rest.slice(0, 1), { annotations: task.annotations, link: task.link }));
    const tail = rest.slice(1);
    if (tail) stack.push({ mode: 'plain', input: tail, annotations: task.annotations, link: task.link });
  }

  return out;
}

function blocksFromInlineRichText(type: string, richText: any) {
  const merged = mergeRichText(richText);
  const chunks = chunkRichText(merged);
  const blocks = [];
  for (const c of chunks) {
    if (!c || !c.length) continue;
    if (type === 'paragraph') {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: c } });
    } else if (type === 'quote') {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: c } });
    } else if (type === 'bulleted_list_item') {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: c } });
    } else if (type === 'numbered_list_item') {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: c } });
    } else if (type === 'to_do') {
      blocks.push({ object: 'block', type: 'to_do', to_do: { rich_text: c, checked: false } });
    } else if (type === 'heading_1') {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: c } });
    } else if (type === 'heading_2') {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: c } });
    } else if (type === 'heading_3') {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: c } });
    }
  }
  return blocks;
}

function markdownToNotionBlocks(markdown: string) {
  const src = normalizeStandaloneImageCaptionLines(markdown).replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const out = [];

  function isBlank(line: unknown): boolean {
    return !String(line || '').trim();
  }

  function isHttpUrl(url: unknown): boolean {
    return /^https?:\/\//i.test(String(url || '').trim());
  }

  function isDataImageUrl(url: unknown): boolean {
    const text = String(url || '').trim();
    if (!text) return false;
    return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?;base64,/i.test(text);
  }

  function stripAngleBrackets(url: unknown): string {
    const text = String(url || '').trim();
    if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
    return text;
  }

  function startsWithFence(line: unknown): boolean {
    return String(line || '')
      .trimStart()
      .startsWith('```');
  }

  function fenceLang(line: unknown): string {
    const t = String(line || '').trimStart();
    return t.slice(3).trim();
  }

  function pushCodeBlock(language: unknown, content: unknown) {
    const lang = normalizeCodeLanguage(language);
    const parts = splitText(content);
    for (const p of parts) {
      if (!String(p || '').length) continue;
      out.push({
        object: 'block',
        type: 'code',
        code: { rich_text: [textRich(p, { annotations: { code: true } })], language: lang },
      });
    }
  }

  function pushEquationBlock(expression: unknown) {
    const expr = normalizeEquationExpression(expression);
    if (!expr) return;
    if (canUseNativeEquation(expr)) {
      out.push({ object: 'block', type: 'equation', equation: { expression: expr } });
      return;
    }
    out.push(...blockEquationFallbackBlocks(expr));
  }

  function parseImageLine(line: unknown) {
    const raw = String(line || '');
    if (/^(?: {4}|\t)/.test(raw)) return null;
    const trimmed = raw.trim();
    const m = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)\s*$/);
    if (!m) return null;
    const url = stripAngleBrackets(String(m[2] || '').trim());
    if (!isHttpUrl(url) && !isDataImageUrl(url) && !isSyncnosAssetUrl(url)) return null;
    return { url, alt: String(m[1] || '') };
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = String(line || '').trim();

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (trimmed === '---') {
      out.push({ object: 'block', type: 'divider', divider: {} });
      i += 1;
      continue;
    }

    if (startsWithFence(line)) {
      const lang = fenceLang(line);
      i += 1;
      const codeLines = [];
      while (i < lines.length && !startsWithFence(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && startsWithFence(lines[i])) i += 1;
      pushCodeBlock(lang, codeLines.join('\n'));
      continue;
    }

    if (trimmed === '$$') {
      i += 1;
      const exprLines = [];
      while (i < lines.length && String(lines[i] || '').trim() !== '$$') {
        exprLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && String(lines[i] || '').trim() === '$$') i += 1;
      pushEquationBlock(exprLines.join('\n'));
      continue;
    }

    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
      pushEquationBlock(trimmed.slice(2, -2));
      i += 1;
      continue;
    }

    const image = parseImageLine(line);
    if (image) {
      out.push({
        object: 'block',
        type: 'image',
        image: { type: 'external', external: { url: image.url } },
      });
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const rich = inlineMarkdownToRichText(text);
      const type = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
      out.push(...blocksFromInlineRichText(type, rich));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (
        i < lines.length &&
        String(lines[i] || '')
          .trim()
          .startsWith('>')
      ) {
        quoteLines.push(String(lines[i] || '').replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const rich = inlineMarkdownToRichText(quoteLines.join('\n'));
      out.push(...blocksFromInlineRichText('quote', rich));
      continue;
    }

    const todo = trimmed.match(/^-\s+\[(x| )\]\s+(.+)$/i);
    if (todo) {
      const checked = String(todo[1] || '').toLowerCase() === 'x';
      const rich = inlineMarkdownToRichText(todo[2] || '');
      const blocks = blocksFromInlineRichText('to_do', rich);
      for (const b of blocks) {
        if (b && b.type === 'to_do') (b as any).to_do.checked = checked;
      }
      out.push(...blocks);
      i += 1;
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      const rich = inlineMarkdownToRichText(bullet[1] || '');
      out.push(...blocksFromInlineRichText('bulleted_list_item', rich));
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      const rich = inlineMarkdownToRichText(numbered[1] || '');
      out.push(...blocksFromInlineRichText('numbered_list_item', rich));
      i += 1;
      continue;
    }

    const paraLines = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      const nextTrim = String(next || '').trim();
      if (
        isBlank(next) ||
        nextTrim === '---' ||
        startsWithFence(next) ||
        nextTrim === '$$' ||
        nextTrim.match(/^(#{1,3})\s+/) ||
        nextTrim.startsWith('>') ||
        nextTrim.match(/^-\s+\[(x| )\]\s+/i) ||
        nextTrim.match(/^[-*+]\s+/) ||
        nextTrim.match(/^\d+\.\s+/)
      ) {
        break;
      }
      paraLines.push(next);
      i += 1;
    }
    const paraText = paraLines.join('\n');
    const rich = inlineMarkdownToRichText(paraText);
    out.push(...blocksFromInlineRichText('paragraph', rich));
  }

  if (out.length || !src.trim()) return out;
  return blocksFromInlineRichText('paragraph', [textRich(src)]);
}

export { markdownToNotionBlocks };
