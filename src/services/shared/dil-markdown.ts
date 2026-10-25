const DIL_TAG_RE =
  /<(?:row|box|col|grid|grid-item|flow|flow-item|card|carousel|carousel-item|text|title|caption|badge|icon|divider|Cite|Link|Entity|AsyncImage)\b/;
const LAYOUT_TAG = '(?:row|box|col|grid|grid-item|flow|flow-item|card|carousel|carousel-item|text|title|caption|badge)';
const OPEN_LAYOUT_RE = new RegExp('^([ \\t]*)<(' + LAYOUT_TAG + ')\\b[^>]*>\\s*$');
const CLOSE_LAYOUT_RE = new RegExp('^\\s*</(' + LAYOUT_TAG + ')>\\s*$');
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function nextFence(current: string, line: string): string {
  const marker = FENCE_RE.exec(line);
  if (!marker) return current;
  const candidate = marker[1]!;
  if (!current) return candidate;
  return candidate[0] === current[0] && candidate.length >= current.length && !line.slice(marker[0].length).trim()
    ? ''
    : current;
}

function attribute(tag: string, name: string): string {
  return new RegExp('\\b' + name + '="([^"]*)"').exec(tag)?.[1] || '';
}

function flattenInlineTags(line: string): string {
  let output = '';
  let codeTicks = 0;
  for (let index = 0; index < line.length; ) {
    if (line[index] === '`') {
      let end = index + 1;
      while (line[end] === '`') end += 1;
      const count = end - index;
      codeTicks = codeTicks === count ? 0 : codeTicks === 0 ? count : codeTicks;
      output += line.slice(index, end);
      index = end;
      continue;
    }

    if (!codeTicks && line[index] === '<') {
      const remaining = line.slice(index);
      const tag =
        /^(?:<Cite\b[^>]*\/>|<Link\b[^>]*\/>|<Entity\b[^>]*\/>|<AsyncImage\b[^>]*\/>|<icon\b[^>]*\/>|<divider\b[^>]*\/>|<\/?(?:row|box|col|grid|grid-item|flow|flow-item|card|carousel|carousel-item|text|title|caption|badge)\b[^>]*>)/.exec(
          remaining,
        )?.[0];
      if (tag) {
        if (tag.startsWith('<Cite')) output += '（引用见原对话）';
        else if (tag.startsWith('<Link')) {
          const url = attribute(tag, 'url');
          const title = attribute(tag, 'title') || url || '链接';
          const escaped = title.replace(/[\[\]\\]/g, '\\$&');
          output += /^https?:\/\//i.test(url) && !/[<>\s]/.test(url) ? '[' + escaped + '](<' + url + '>)' : escaped;
        } else if (tag.startsWith('<Entity')) output += attribute(tag, 'value');
        else if (tag.startsWith('<AsyncImage')) output += '图片：' + (attribute(tag, 'query') || '请在原对话查看');
        else if (tag.startsWith('<icon') && attribute(tag, 'name') === 'arrow-down') output += '↓';
        else if (tag.startsWith('<divider')) output += '\n\n---\n\n';
        else if (tag.startsWith('</')) output += '\n\n';
        index += tag.length;
        continue;
      }
    }
    output += line[index];
    index += 1;
  }
  return output;
}

function dedentRichBlocks(lines: string[]): void {
  let fence = '';
  for (let index = 0; index < lines.length; ) {
    const line = lines[index]!;
    const marker = FENCE_RE.exec(line);
    if (marker) {
      fence = nextFence(fence, line);
      index += 1;
      continue;
    }
    if (fence || !/^ {4,}\S/.test(line)) {
      index += 1;
      continue;
    }

    let end = index;
    let minimum = Infinity;
    let hasMarkdown = false;
    while (end < lines.length && (!lines[end]!.trim() || /^ {4,}\S/.test(lines[end]!))) {
      const current = lines[end]!;
      if (current.trim()) {
        minimum = Math.min(minimum, current.match(/^ */)![0].length);
        if (/^ {4,}(?:\*\*|\|[^\n]*\||\\\[|#{1,6} )/.test(current)) hasMarkdown = true;
      }
      end += 1;
    }
    const nearbyArrow = lines
      .slice(Math.max(0, index - 3), Math.min(lines.length, end + 3))
      .some((entry) => entry.trim() === '↓');
    if (hasMarkdown && (minimum >= 6 || nearbyArrow)) {
      for (let position = index; position < end; position += 1) {
        if (lines[position]!.trim()) lines[position] = lines[position]!.slice(minimum);
      }
    }
    index = end;
  }
}

export function normalizeDilMarkdown(source: string): string {
  if (!DIL_TAG_RE.test(source)) return source;
  let sourceFence = '';
  let actionable = false;
  for (const line of source.split('\n')) {
    const marker = FENCE_RE.exec(line);
    if (marker) {
      sourceFence = nextFence(sourceFence, line);
    } else if (!sourceFence && flattenInlineTags(line) !== line) {
      actionable = true;
      break;
    }
  }
  if (!actionable) return source;
  const lines: string[] = [];
  const layout: Array<{ tag: string; contentIndent?: number }> = [];
  let fence = '';
  let hasLayout = false;
  const hasDivider = /<divider\b/.test(source);

  for (const original of source.replace(/\r\n?/g, '\n').split('\n')) {
    const open = !fence ? OPEN_LAYOUT_RE.exec(original) : null;
    if (open) {
      hasLayout = true;
      layout.push({ tag: open[2]! });
      lines.push('');
      continue;
    }
    const close = !fence ? CLOSE_LAYOUT_RE.exec(original) : null;
    if (close) {
      hasLayout = true;
      if (layout.at(-1)?.tag === close[1]) layout.pop();
      lines.push('');
      continue;
    }

    let line = original;
    if (layout.length && line.trim()) {
      const current = layout.at(-1)!;
      const whitespace = line.match(/^ */)![0].length;
      if (current.contentIndent === undefined) current.contentIndent = whitespace;
      line = line.slice(Math.min(current.contentIndent, whitespace));
    }
    const marker = FENCE_RE.exec(line);
    if (marker) fence = nextFence(fence, line);
    lines.push(fence && !marker ? line : flattenInlineTags(line));
  }

  if (hasLayout || hasDivider) dedentRichBlocks(lines);
  const compacted: string[] = [];
  let blankCount = 0;
  let currentFence = '';
  for (const line of lines) {
    const marker = FENCE_RE.exec(line);
    if (marker) {
      currentFence = nextFence(currentFence, line);
      blankCount = 0;
    }
    if (currentFence || marker || line.trim()) {
      compacted.push(line);
      if (line.trim()) blankCount = 0;
    } else if (blankCount++ < 2) {
      compacted.push(line);
    }
  }
  return compacted.join('\n').trim();
}
