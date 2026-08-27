import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { normalizeCommentThreadGraph } from '@services/comments/domain/comment-thread-graph';
import { normalizeStandaloneImageCaptionLines } from '@services/sync/shared/markdown-image-normalizer';

const MESSAGES_HEADING = 'Conversations';
const ARTICLE_HEADING = 'Article';
const COMMENTS_HEADING = 'Comments';
const DEFAULT_COMMENT_AUTHOR = 'You';

type CommentTimeZone = 'local' | 'utc';

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, '0');
}

function formatCommentTime(ts: unknown, timeZone: CommentTimeZone): string {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    const d = new Date(t);
    const utc = timeZone === 'utc';
    const yyyy = utc ? d.getUTCFullYear() : d.getFullYear();
    const mm = pad2((utc ? d.getUTCMonth() : d.getMonth()) + 1);
    const dd = pad2(utc ? d.getUTCDate() : d.getDate());
    const hh = pad2(utc ? d.getUTCHours() : d.getHours());
    const min = pad2(utc ? d.getUTCMinutes() : d.getMinutes());
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

function buildCommentMetaLine(input: { authorName?: unknown; createdAt: unknown; timeZone: CommentTimeZone }) {
  const authorName = safeString(input?.authorName) || DEFAULT_COMMENT_AUTHOR;
  const time = formatCommentTime(input?.createdAt, input.timeZone);
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

function buildCommentsMarkdown(comments: ArticleCommentDto[], timeZone: CommentTimeZone) {
  const graph = normalizeCommentThreadGraph(comments);
  const output: string[] = [];

  const renderItem = (comment: ArticleCommentDto): string => {
    const lines: string[] = [];
    const head = buildListItemHead(
      buildCommentMetaLine({ authorName: comment.authorName, createdAt: comment.createdAt, timeZone }),
      0,
    );
    if (head) lines.push(head);
    const text = safeString(comment.commentText);
    if (text) lines.push(...buildListItemParagraph(text, 0));
    return lines.join('\n').trim();
  };

  for (const thread of graph.threads) {
    const chunks: string[] = [];
    const quote = safeString(thread.root.quoteText);
    if (quote) chunks.push(buildMarkdownQuote(quote));
    const items = [thread.root, ...thread.replies].map(renderItem).filter(Boolean);
    if (items.length) chunks.push(items.join('\n\n'));
    const rendered = chunks.join('\n\n').trim();
    if (!rendered) continue;
    if (output.length) output.push('---');
    output.push(rendered);
  }
  return output.join('\n\n').trim();
}

function buildFullNoteMarkdown({
  conversation,
  messages,
  syncnosObject,
  comments,
  commentTimeZone = 'local',
}: {
  conversation?: any;
  messages?: any[];
  syncnosObject?: any;
  comments?: ArticleCommentDto[];
  commentTimeZone?: CommentTimeZone;
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
    const commentsRootCount = normalizeCommentThreadGraph(comments || []).threads.length;
    frontmatter.comments_root_count = commentsRootCount;
    const articleMd = buildArticleBodyMarkdown(messages || []);
    const commentsMd = buildCommentsMarkdown(comments || [], commentTimeZone);
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
  buildFullNoteMarkdown,
};

export { MESSAGES_HEADING, ARTICLE_HEADING, COMMENTS_HEADING, buildFullNoteMarkdown };
export default api;
