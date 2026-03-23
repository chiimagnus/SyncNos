import type { ArticleComment } from '@services/comments/domain/models';

const MAX_TEXT = 1900;
const NOTION_COMMENTS_DIGEST_VERSION = 5;
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

function replyParagraphBlocks(reply: ArticleComment): any[] {
  const metaLine = formatCommentMetaLine({ authorName: (reply as any)?.authorName, createdAt: reply?.createdAt });
  const replyText = safeString(reply?.commentText);
  const parts = splitText(replyText);
  const lines: string[] = [];
  if (metaLine) lines.push(metaLine);
  if (parts.length) lines.push(parts[0]!);
  const out: any[] = [];
  if (lines.length) out.push(paragraphBlock(lines.join('\n')));
  if (parts.length > 1) out.push(...paragraphBlocksFromParts(parts.slice(1)));
  return out;
}

export function buildNotionCommentsBlocks(comments: ArticleComment[]): {
  blocks: any[];
  threads: number;
  items: number;
} {
  const list = Array.isArray(comments) ? comments.slice() : [];
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

  const blocks: any[] = [];
  let threads = 0;
  let items = 0;

  for (const root of roots) {
    if (!root) continue;
    const threadBlocks: any[] = [];
    const quoteText = safeString(root.quoteText);
    const quoteParts = splitText(quoteText);
    if (quoteParts.length) {
      threads += 1;
      for (const part of quoteParts) threadBlocks.push(quoteBlock(part));
    }

    const ordered: ArticleComment[] = [];
    const pushDescendants = (parent: ArticleComment) => {
      const replies = byParentId.get(Number(parent?.id)) || [];
      for (const reply of replies) {
        ordered.push(reply);
        pushDescendants(reply);
      }
    };
    ordered.push(root);
    pushDescendants(root);

    for (const c of ordered) {
      const text = safeString(c?.commentText);
      const metaLine = formatCommentMetaLine({ authorName: (c as any)?.authorName, createdAt: c?.createdAt });
      if (text) items += 1;
      if (text) {
        threadBlocks.push(
          commentItemBlock({
            authorName: (c as any)?.authorName,
            commentText: text,
            createdAt: c?.createdAt,
          } as any),
        );
      } else if (metaLine) {
        // Keep an anchor bullet for metadata-only comments so replies remain understandable.
        threadBlocks.push(bulletedItemBlock(metaLine));
      }
    }

    if (!threadBlocks.length) continue;
    if (blocks.length) blocks.push(dividerBlock());
    blocks.push(...threadBlocks);
  }

  return { blocks, threads, items };
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

export function computeNotionCommentsDigest(comments: ArticleComment[]): string {
  const list = Array.isArray(comments) ? comments.slice() : [];
  list.sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  const normalized = list.map((c) => ({
    id: Number(c?.id || 0),
    parentId: c?.parentId == null ? null : Number(c.parentId),
    createdAt: Number(c?.createdAt || 0),
    updatedAt: Number(c?.updatedAt || 0),
    quoteText: safeString(c?.quoteText),
    commentText: safeString(c?.commentText),
  }));
  return fnv1a32(JSON.stringify({ v: NOTION_COMMENTS_DIGEST_VERSION, items: normalized }));
}
