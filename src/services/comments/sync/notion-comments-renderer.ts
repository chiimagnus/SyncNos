import type { ArticleCommentDto } from '@services/comments/domain/comment-dto';
import { normalizeCommentThreadGraph } from '@services/comments/domain/comment-thread-graph';

const MAX_TEXT = 1900;
const NOTION_COMMENTS_DIGEST_VERSION = 7;
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

function formatCommentMetaLine(input: { authorName?: unknown; createdAt?: unknown }): string {
  const authorName = safeString(input?.authorName) || DEFAULT_COMMENT_AUTHOR;
  const time = formatCommentTime(input?.createdAt);
  if (!time) return authorName;
  return `${authorName} | ${time}`;
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function splitText(text: unknown): string[] {
  const src = String(text || '');
  if (!src) return [];
  if (src.length <= MAX_TEXT) return [src];
  const parts: string[] = [];
  let remaining = src;
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
  return parts.filter((p) => String(p || '').length);
}

function textRich(content: string) {
  return { type: 'text', text: { content } };
}

function quoteBlock(content: string) {
  return {
    object: 'block',
    type: 'quote',
    quote: { rich_text: [textRich(content)] },
  } as any;
}

function paragraphBlock(content: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [textRich(content)] },
  } as any;
}

function paragraphBlocksFromParts(parts: string[]): any[] {
  const list = Array.isArray(parts) ? parts : [];
  return list.map((p) => paragraphBlock(p)).filter(Boolean);
}

function dividerBlock() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  } as any;
}

function bulletedItemBlock(content: string, children?: any[]) {
  const resolvedChildren = Array.isArray(children) && children.length ? children : undefined;
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [textRich(content)],
      ...(resolvedChildren ? { children: resolvedChildren } : null),
    },
  } as any;
}

function commentItemBlock(input: {
  authorName?: unknown;
  commentText: unknown;
  createdAt: unknown;
  extraChildren?: any[];
}) {
  const metaLine = formatCommentMetaLine({ authorName: input?.authorName, createdAt: input?.createdAt });
  const commentText = safeString(input?.commentText);
  const commentParts = splitText(commentText);

  const children: any[] = [];
  if (commentParts.length) children.push(...paragraphBlocksFromParts(commentParts));
  if (Array.isArray(input?.extraChildren) && input.extraChildren.length) children.push(...input.extraChildren);

  return bulletedItemBlock(metaLine, children);
}

export function buildNotionCommentsBlocks(comments: ArticleCommentDto[]): {
  blocks: any[];
  threads: number;
  items: number;
} {
  const graph = normalizeCommentThreadGraph(comments);
  const blocks: any[] = [];
  let items = 0;

  for (const thread of graph.threads) {
    const threadBlocks: any[] = [];
    for (const part of splitText(safeString(thread.root.quoteText))) threadBlocks.push(quoteBlock(part));

    for (const comment of [thread.root, ...thread.replies]) {
      const text = safeString(comment.commentText);
      const metaLine = formatCommentMetaLine({ authorName: comment.authorName, createdAt: comment.createdAt });
      if (text) {
        items += 1;
        threadBlocks.push(
          commentItemBlock({
            authorName: comment.authorName,
            commentText: text,
            createdAt: comment.createdAt,
          }),
        );
      } else if (metaLine) {
        threadBlocks.push(bulletedItemBlock(metaLine));
      }
    }

    if (!threadBlocks.length) continue;
    if (blocks.length) blocks.push(dividerBlock());
    blocks.push(...threadBlocks);
  }

  return { blocks, threads: graph.threads.length, items };
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 to make unsigned
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeCommentForDigest(comment: ArticleCommentDto) {
  return {
    authorName: safeString(comment.authorName),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    quoteText: safeString(comment.quoteText),
    commentText: safeString(comment.commentText),
    locatorVersion: comment.locator?.v ?? null,
    locator: comment.locator ?? null,
  };
}

export function computeNotionCommentsDigest(comments: ArticleCommentDto[]): string {
  const graph = normalizeCommentThreadGraph(comments);
  const threads = graph.threads.map((thread) => ({
    root: normalizeCommentForDigest(thread.root),
    replies: thread.replies.map(normalizeCommentForDigest),
  }));
  return fnv1a32(JSON.stringify({ v: NOTION_COMMENTS_DIGEST_VERSION, threads }));
}
