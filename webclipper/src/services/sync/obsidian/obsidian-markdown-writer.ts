import type { ArticleComment } from '@services/comments/domain/models';
import { computeArticleCommentThreadCount } from '@services/comments/domain/comment-metrics';
import { normalizeStandaloneImageCaptionLines } from '@services/sync/shared/markdown-image-normalizer';

const MESSAGES_HEADING = 'Conversations';
const ARTICLE_HEADING = 'Article';
const COMMENTS_HEADING = 'Comments';
const DEFAULT_COMMENT_AUTHOR = 'You';

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, '0');
}

function formatCommentTime(ts: unknown): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    const d = new Date(t);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const min = pad2(d.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch (_e) {
    return '';
  }
}

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function normalizeNewlines(input: unknown) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
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
  const role = normalizeRole(m.role);
  const roleLabel = role === 'user' ? safeString(m.authorName) || DEFAULT_COMMENT_AUTHOR : role;
  const body = safeString(m.contentMarkdown) || safeString(m.contentText) || '';
  const header = `## ${seq} ${roleLabel}`.trim();
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
    .map((m) => {
      const raw = safeString(m?.contentMarkdown) || safeString(m?.contentText);
      return normalizeStandaloneImageCaptionLines(raw);
    })
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

function buildCommentMetaLine(input: { authorName?: unknown; createdAt: unknown }) {
  const authorName = safeString(input?.authorName) || DEFAULT_COMMENT_AUTHOR;
  const time = formatCommentTime(input?.createdAt);
  if (!time) return authorName;
  return `${authorName} | ${time}`;
}

function buildListItemHead(metaLine: string, indentLevel: number) {
  const meta = safeString(metaLine);
  if (!meta) return '';
  const indent = '  '.repeat(Math.max(0, indentLevel));
  return `${indent}- ${meta}`.trimEnd();
}

function buildListItemParagraph(text: string, indentLevel: number): string[] {
  const src = normalizeNewlines(text).trim();
  if (!src) return [];
  const indent = '  '.repeat(Math.max(0, indentLevel));
  return src
    .split('\n')
    .map((line) => `${indent}  ${line}`.trimEnd())
    .filter((x) => !!x);
}

function buildObsidianCommentsMarkdown(comments: ArticleComment[]) {
  const list = Array.isArray(comments) ? comments.slice() : [];
  if (!list.length) return '';

  list.sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));

  const byId = new Map<number, ArticleComment>();
  for (const c of list) {
    const id = Number(c?.id);
    if (Number.isFinite(id) && id > 0) byId.set(id, c);
  }

  const byParentId = new Map<number, ArticleComment[]>();
  const roots: ArticleComment[] = [];
  for (const c of list) {
    const parentId = c && c.parentId != null ? Number(c.parentId) : null;
    if (parentId && Number.isFinite(parentId) && parentId > 0 && byId.has(parentId)) {
      const bucket = byParentId.get(parentId) || [];
      bucket.push(c);
      byParentId.set(parentId, bucket);
    } else {
      roots.push(c);
    }
  }

  function renderFlatBulletItem(comment: ArticleComment): string[] {
    const out: string[] = [];
    const metaLine = buildCommentMetaLine({ authorName: (comment as any)?.authorName, createdAt: comment?.createdAt });
    const head = buildListItemHead(metaLine, 0);
    if (head) out.push(head);
    const text = safeString(comment?.commentText);
    if (text) out.push(...buildListItemParagraph(text, 0));
    return out.filter((x) => !!x);
  }

  function renderFlatThread(root: ArticleComment): string[] {
    const out: string[] = [];
    const visited = new Set<number>();

    const pushRecursive = (comment: ArticleComment) => {
      if (!comment) return;
      const id = Number(comment?.id);
      if (Number.isFinite(id) && id > 0) {
        if (visited.has(id)) return;
        visited.add(id);
      }
      const itemLines = renderFlatBulletItem(comment);
      if (itemLines.length) out.push(itemLines.join('\n'));

      const replies = byParentId.get(Number(comment?.id)) || [];
      for (const reply of replies) {
        pushRecursive(reply);
      }
    };

    pushRecursive(root);
    return out.filter((x) => !!x);
  }

  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const thread: string[] = [];
    const quote = safeString(root.quoteText);
    if (quote) {
      thread.push(buildMarkdownQuote(quote));
      thread.push('');
    }

    const items = renderFlatThread(root);
    if (items.length) thread.push(items.join('\n\n'));

    const threadText = thread.join('\n').trim();
    if (!threadText) continue;

    if (out.length) {
      out.push('---', '');
    }
    out.push(threadText, '');
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
  const url = safeString(c.url);
  const sourceType = safeString(c.sourceType);

  const frontmatter: Record<string, unknown> = {
    ...(url ? { url } : null),
    syncnos: syncnosObject || null,
  };

  const isArticle = sourceType === 'article';
  if (isArticle) {
    const commentsRootCount = computeArticleCommentThreadCount(comments || []);
    frontmatter.comments_root_count = commentsRootCount;
    const articleMd = buildArticleBodyMarkdown(messages || []);
    const commentsMd = buildObsidianCommentsMarkdown(comments || []);
    const sections: string[] = [];
    sections.push(`## ${ARTICLE_HEADING}`, '', articleMd || '', '', `## ${COMMENTS_HEADING}`, '', commentsMd || '');
    return buildFrontmatterBlock(frontmatter) + `${sections.join('\n').trim()}\n`;
  }

  const messagesMd = buildMessagesMarkdown(messages || []);
  return buildFrontmatterBlock(frontmatter) + `# ${MESSAGES_HEADING}\n\n` + messagesMd;
}

const api = {
  MESSAGES_HEADING,
  ARTICLE_HEADING,
  COMMENTS_HEADING,
  buildArticleBodyMarkdown,
  buildObsidianCommentsMarkdown,
  buildFullNoteMarkdown,
};

export {
  MESSAGES_HEADING,
  ARTICLE_HEADING,
  COMMENTS_HEADING,
  buildArticleBodyMarkdown,
  buildObsidianCommentsMarkdown,
  buildFullNoteMarkdown,
};
export default api;
