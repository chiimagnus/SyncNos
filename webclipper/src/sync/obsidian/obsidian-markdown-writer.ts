import type { ArticleComment } from '../../comments/domain/models';

const MESSAGES_HEADING = 'Conversations';
const ARTICLE_HEADING = 'Article';
const COMMENTS_HEADING = 'Comments';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function normalizeNewlines(input: unknown) {
  return String(input || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLevel2HeadingRanges(lines: string[], heading: string) {
  const ranges: Array<{ headingIndex: number; bodyStart: number; bodyEnd: number }> = [];
  const target = safeString(heading);
  if (!target) return ranges;
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(target)}\\s*$`);
  const endRe = /^(#{1,2})\s+/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    if (!headingRe.test(line.trimEnd())) continue;
    const bodyStart = i + 1;
    let bodyEnd = lines.length;
    for (let j = bodyStart; j < lines.length; j += 1) {
      const nextLine = lines[j] || '';
      if (endRe.test(nextLine)) {
        bodyEnd = j;
        break;
      }
    }
    ranges.push({ headingIndex: i, bodyStart, bodyEnd });
    i = bodyEnd - 1;
  }
  return ranges;
}

function buildSectionBodyLines(markdownBody: string) {
  const trimmed = normalizeNewlines(markdownBody).trim();
  const out: string[] = [''];
  if (trimmed) out.push(...trimmed.split('\n'));
  out.push('');
  return out;
}

function replaceLevel2HeadingSectionInMarkdown({
  sourceMarkdown,
  heading,
  bodyMarkdown,
  dedupe,
}: {
  sourceMarkdown: unknown;
  heading: string;
  bodyMarkdown: string;
  dedupe?: boolean;
}) {
  const src = normalizeNewlines(sourceMarkdown);
  const lines = src.split('\n');
  const ranges = findLevel2HeadingRanges(lines, heading);
  if (!ranges.length) return { ok: false, markdown: src, error: 'heading_not_found' };

  if (dedupe) {
    for (let i = ranges.length - 1; i >= 1; i -= 1) {
      const r = ranges[i]!;
      lines.splice(r.headingIndex, r.bodyEnd - r.headingIndex);
    }
  }

  const nextRanges = findLevel2HeadingRanges(lines, heading);
  if (!nextRanges.length) return { ok: false, markdown: lines.join('\n'), error: 'heading_not_found' };
  const primary = nextRanges[0]!;
  const bodyLines = buildSectionBodyLines(bodyMarkdown);
  lines.splice(primary.bodyStart, primary.bodyEnd - primary.bodyStart, ...bodyLines);
  return { ok: true, markdown: lines.join('\n') };
}

function yamlEscapeString(value: unknown) {
  const text = safeString(value);
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toYaml(obj: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  const entries = obj && typeof obj === 'object' ? Object.entries(obj as any) : [];
  for (const [k, v] of entries) {
    if (v == null) continue;
    const key = safeString(k);
    if (!key) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${pad}${key}:`);
      lines.push(...toYaml(v, indent + 2));
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${key}:`);
      for (const item of v) {
        if (item == null) continue;
        if (typeof item === 'object') {
          lines.push(`${pad}-`);
          lines.push(...toYaml(item, indent + 2));
        } else {
          lines.push(`${pad}- ${yamlEscapeString(String(item))}`);
        }
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${pad}${key}: ${String(v)}`);
    } else {
      lines.push(`${pad}${key}: ${yamlEscapeString(String(v))}`);
    }
  }
  return lines;
}

function buildFrontmatterBlock(frontmatter: unknown) {
  const fm = frontmatter && typeof frontmatter === 'object' ? (frontmatter as any) : {};
  const lines = ['---', ...toYaml(fm, 0), '---'];
  return `${lines.join('\n')}\n\n`;
}

function normalizeRole(role: unknown) {
  const normalized = safeString(role).toLowerCase();
  if (!normalized) return 'assistant';
  return normalized;
}

function buildMessageChunk(message: any) {
  const m = message || {};
  const seq = Number.isFinite(Number(m.sequence)) ? Number(m.sequence) : 0;
  const key = safeString(m.messageKey) || '';
  const role = normalizeRole(m.role);
  const body = safeString(m.contentMarkdown) || safeString(m.contentText) || '';
  const header = `## ${seq} ${role}`.trim();
  return `${header}\n\n${body}\n\n`;
}

function buildMessagesMarkdown(messages: any[]) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => buildMessageChunk(m)).join('');
}

function toArticleBodyMessages(messages: unknown[]): any[] {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((message) => {
    if (!message || typeof message !== 'object') return false;
    const key = safeString((message as any).messageKey);
    if (key) return key === 'article_body';
    const markdown = safeString((message as any).contentMarkdown);
    const text = safeString((message as any).contentText);
    return !!markdown || !!text;
  });
}

function buildArticleBodyMarkdown(messages: any[]) {
  const list = toArticleBodyMessages(messages);
  const chunks = list
    .map((m) => safeString(m?.contentMarkdown) || safeString(m?.contentText))
    .filter((x) => !!x);
  return chunks.join('\n\n').trim();
}

function buildMarkdownQuote(text: string) {
  const src = normalizeNewlines(text).trim();
  if (!src) return '';
  return src
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

function buildBulletItem(text: string, indentLevel: number) {
  const src = normalizeNewlines(text).trim();
  if (!src) return '';
  const indent = '  '.repeat(Math.max(0, indentLevel));
  const lines = src.split('\n');
  const first = lines.shift() || '';
  const rest = lines;
  const head = `${indent}- ${first}`.trimEnd();
  if (!rest.length) return head;
  const tail = rest.map((line) => `${indent}  ${line}`.trimEnd()).join('\n');
  return `${head}\n${tail}`.trimEnd();
}

function buildObsidianCommentsMarkdown(comments: ArticleComment[]) {
  const list = Array.isArray(comments) ? comments.slice() : [];
  if (!list.length) return '';

  list.sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));

  const byParentId = new Map<number, ArticleComment[]>();
  const roots: ArticleComment[] = [];
  for (const c of list) {
    const parentId = c && c.parentId != null ? Number(c.parentId) : null;
    if (parentId && Number.isFinite(parentId) && parentId > 0) {
      const bucket = byParentId.get(parentId) || [];
      bucket.push(c);
      byParentId.set(parentId, bucket);
    } else {
      roots.push(c);
    }
  }

  function renderThreadItems(comment: ArticleComment, depth: number): string[] {
    const lines: string[] = [];
    const text = safeString(comment?.commentText);
    const hasText = !!text;
    if (hasText) lines.push(buildBulletItem(text, depth));
    const replies = byParentId.get(Number(comment?.id)) || [];
    for (const reply of replies) {
      lines.push(...renderThreadItems(reply, hasText ? depth + 1 : depth));
    }
    return lines.filter((x) => !!x);
  }

  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const quote = safeString(root.quoteText);
    if (quote) {
      out.push(buildMarkdownQuote(quote));
      out.push('');
    }

    const items = renderThreadItems(root, 0);
    if (items.length) out.push(items.join('\n'));
    out.push('');
  }

  return out.join('\n').trim();
}

function buildFullNoteMarkdown({
  conversation,
  messages,
  syncnosObject,
  comments,
}: {
  conversation?: any;
  messages?: any[];
  syncnosObject?: any;
  comments?: ArticleComment[];
}) {
  const c = conversation || {};
  const title = safeString(c.title) || 'Untitled';
  const url = safeString(c.url);
  const sourceType = safeString(c.sourceType);

  const frontmatter = {
    ...(url ? { url } : null),
    syncnos: syncnosObject || null,
  };

  const isArticle = sourceType === 'article';
  if (isArticle) {
    const articleMd = buildArticleBodyMarkdown(messages || []);
    const commentsMd = buildObsidianCommentsMarkdown(comments || []);
    const sections: string[] = [];
    sections.push(`## ${ARTICLE_HEADING}`, '', articleMd || '', '', `## ${COMMENTS_HEADING}`, '', commentsMd || '');
    return buildFrontmatterBlock(frontmatter) + `${sections.join('\n').trim()}\n`;
  }

  const messagesMd = buildMessagesMarkdown(messages || []);
  return (
    buildFrontmatterBlock(frontmatter) +
    `# ${MESSAGES_HEADING}\n\n` +
    messagesMd
  );
}

function buildIncrementalAppendMarkdown({ newMessages }: { newMessages?: any[] }) {
  return buildMessagesMarkdown(newMessages || []);
}

async function appendUnderMessagesHeading({
  client,
  filePath,
  markdown,
}: {
  client: any;
  filePath: string;
  markdown: string;
}) {
  return client.patchVaultFile(filePath, {
    operation: 'append',
    targetType: 'heading',
    target: MESSAGES_HEADING,
    createTargetIfMissing: true,
    body: String(markdown || ''),
    contentType: 'text/markdown',
  });
}

async function replaceUnderHeading({
  client,
  filePath,
  heading,
  markdown,
}: {
  client: any;
  filePath: string;
  heading: string;
  markdown: string;
}) {
  return client.patchVaultFile(filePath, {
    operation: 'replace',
    targetType: 'heading',
    target: safeString(heading),
    createTargetIfMissing: true,
    body: String(markdown || ''),
    contentType: 'text/markdown',
  });
}

async function replaceUnderArticleHeading({
  client,
  filePath,
  markdown,
}: {
  client: any;
  filePath: string;
  markdown: string;
}) {
  return replaceUnderHeading({ client, filePath, heading: ARTICLE_HEADING, markdown });
}

async function replaceUnderCommentsHeading({
  client,
  filePath,
  markdown,
}: {
  client: any;
  filePath: string;
  markdown: string;
}) {
  return replaceUnderHeading({ client, filePath, heading: COMMENTS_HEADING, markdown });
}

async function replaceSyncnosFrontmatter({
  client,
  filePath,
  syncnosObject,
}: {
  client: any;
  filePath: string;
  syncnosObject: any;
}) {
  return client.patchVaultFile(filePath, {
    operation: 'replace',
    targetType: 'frontmatter',
    target: 'syncnos',
    createTargetIfMissing: true,
    body: JSON.stringify(syncnosObject || {}),
    contentType: 'application/json',
  });
}

const api = {
  MESSAGES_HEADING,
  ARTICLE_HEADING,
  COMMENTS_HEADING,
  replaceLevel2HeadingSectionInMarkdown,
  buildArticleBodyMarkdown,
  buildObsidianCommentsMarkdown,
  buildFullNoteMarkdown,
  buildIncrementalAppendMarkdown,
  appendUnderMessagesHeading,
  replaceUnderArticleHeading,
  replaceUnderCommentsHeading,
  replaceSyncnosFrontmatter,
};

export {
  MESSAGES_HEADING,
  ARTICLE_HEADING,
  COMMENTS_HEADING,
  replaceLevel2HeadingSectionInMarkdown,
  buildArticleBodyMarkdown,
  buildObsidianCommentsMarkdown,
  buildFullNoteMarkdown,
  buildIncrementalAppendMarkdown,
  appendUnderMessagesHeading,
  replaceUnderArticleHeading,
  replaceUnderCommentsHeading,
  replaceSyncnosFrontmatter,
};
export default api;
