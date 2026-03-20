import type { ArticleComment } from '../domain/models';

const MAX_TEXT = 1900;

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

function bulletedItemBlock(content: string, continuation?: string[]) {
  const children = Array.isArray(continuation) && continuation.length
    ? continuation.map((p) => paragraphBlock(p))
    : undefined;
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [textRich(content)],
      ...(children ? { children } : null),
    },
  } as any;
}

export function buildNotionCommentsBlocks(comments: ArticleComment[]): {
  blocks: any[];
  threads: number;
  items: number;
} {
  const list = Array.isArray(comments) ? comments.slice() : [];
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

  const blocks: any[] = [];
  let threads = 0;
  let items = 0;

  for (const root of roots) {
    if (!root) continue;
    const quoteText = safeString(root.quoteText);
    const quoteParts = splitText(quoteText);
    if (quoteParts.length) {
      threads += 1;
      for (const part of quoteParts) blocks.push(quoteBlock(part));
    }

    const rootText = safeString(root.commentText);
    const rootParts = splitText(rootText);
    if (rootParts.length) {
      items += 1;
      blocks.push(bulletedItemBlock(rootParts[0]!, rootParts.slice(1)));
    }

    const replies = byParentId.get(Number(root.id)) || [];
    for (const reply of replies) {
      const replyText = safeString(reply?.commentText);
      const replyParts = splitText(replyText);
      if (!replyParts.length) continue;
      items += 1;
      blocks.push(bulletedItemBlock(`↳ ${replyParts[0]}`, replyParts.slice(1)));
    }
  }

  return { blocks, threads, items };
}

