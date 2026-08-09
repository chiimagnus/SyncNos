import type { ArticleFetchSiteSpec } from '@collectors/web/article-fetch-sites/site-spec';
import { normalizeText } from '@collectors/web/article-extract/url';

export const XIAOHONGSHU_NOTE_SITE_SPEC: ArticleFetchSiteSpec = {
  id: 'xiaohongshu_note',
  rootSelector: '#noteContainer',
  titleFallbackOrder: ['document', 'meta'],
  authorSelector: '.author-wrapper .name .username, .author-wrapper .name',
  publishedAtSelector: '.info .date span, .info .date',
  textSelector: '.content .note-text, .note-text, .content',
  textPrefer: 'innerText',
  imageSelectorCandidates: [
    // Prefer Swiper real slides (loop mode clones can put the "last image" at DOM start).
    '.swiper-wrapper .swiper-slide:not(.swiper-slide-duplicate) img',
    // Fallback selectors for non-swiper layouts / legacy DOM.
    '.media-container img, .note-slider-img img, .img-container img',
  ],
  imageSrcAttributes: ['data-src', 'data-original', 'src'],
  imageSanitizer: 'none',
};

type XiaohongshuComment = {
  author: string;
  date: string;
  content: string;
  replies: XiaohongshuComment[];
};

function readText(node: Element | null): string {
  return normalizeText((node as any)?.innerText || node?.textContent || '');
}

function readCommentDate(comment: Element): string {
  const date = comment.querySelector('.info .date');
  if (!date) return '';

  const primary = Array.from(date.children).find((child) => !child.classList.contains('location')) || null;
  return readText(primary || date);
}

function readComment(comment: Element): XiaohongshuComment | null {
  const content = readText(comment.querySelector('.content .note-text'));
  if (!content) return null;

  return {
    author: readText(comment.querySelector('.author .name')),
    date: readCommentDate(comment),
    content,
    replies: [],
  };
}

function readReplies(parent: Element): XiaohongshuComment[] {
  const replyContainer = Array.from(parent.children).find((child) => child.classList.contains('reply-container'));
  if (!replyContainer) return [];

  return Array.from(replyContainer.querySelectorAll('.comment-item.comment-item-sub'))
    .map((comment) => readComment(comment))
    .filter((comment): comment is XiaohongshuComment => comment !== null);
}

function readParentComments(): XiaohongshuComment[] {
  const comments = document.querySelector('#noteContainer .comments-el .comments-container');
  if (!comments) return [];

  const list = Array.from(comments.children).find((child) => child.classList.contains('list-container'));
  if (!list) return [];

  return Array.from(list.children)
    .filter((parent) => parent.classList.contains('parent-comment'))
    .map((parent) => {
      const comment = Array.from(parent.children)
        .filter((child) => child.classList.contains('comment-item') && !child.classList.contains('comment-item-sub'))
        .map((item) => readComment(item))[0];
      if (!comment) return null;
      comment.replies = readReplies(parent);
      return comment;
    })
    .filter((comment): comment is XiaohongshuComment => comment !== null);
}

function buildCommentList(doc: Document, comments: XiaohongshuComment[]): HTMLOListElement {
  const list = doc.createElement('ol');
  for (const comment of comments) {
    const item = doc.createElement('li');
    const meta = doc.createElement('p');
    if (comment.author) {
      const author = doc.createElement('strong');
      author.textContent = comment.author;
      meta.append(author);
    }
    if (comment.date) {
      if (meta.childNodes.length) meta.append(' · ');
      const time = doc.createElement('time');
      time.textContent = comment.date;
      meta.append(time);
    }
    if (meta.childNodes.length) item.append(meta);

    const content = doc.createElement('p');
    content.textContent = comment.content;
    item.append(content);

    if (comment.replies.length) item.append(buildCommentList(doc, comment.replies));
    list.append(item);
  }
  return list;
}

function commentText(comment: XiaohongshuComment, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  const meta = [comment.author, comment.date].filter(Boolean).join(' · ');
  const lines = [meta, comment.content].filter(Boolean).map((line) => `${indent}${depth ? '↳ ' : ''}${line}`);
  for (const reply of comment.replies) lines.push(...commentText(reply, depth + 1));
  return lines;
}

export function extractXiaohongshuComments() {
  const comments = readParentComments();
  if (!comments.length) return null;

  const section = document.createElement('section');
  section.setAttribute('data-syncnos-origin', 'xiaohongshu-comments');
  const title = document.createElement('h2');
  title.textContent = '评论区';
  section.append(title, buildCommentList(document, comments));

  return {
    contentHTML: section.outerHTML,
    textContent: ['评论区', ...comments.flatMap((comment) => commentText(comment))].join('\n'),
  };
}
