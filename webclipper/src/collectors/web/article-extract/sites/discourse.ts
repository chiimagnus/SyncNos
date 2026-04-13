import { normalizeText } from '@collectors/web/article-extract/url';
import { htmlToMarkdown } from '@collectors/web/article-extract/markdown';
import { htmlToMarkdownTurndown } from '@collectors/web/article-extract/markdown-turndown';

export function parseDiscourseTopicPathOnPage(
  pathname: unknown,
  discourseTopicPathRe: RegExp,
): {
  slug: string;
  topicId: string;
  postNumber: string | null;
} | null {
  const text = String(pathname || '').trim();
  if (!text) return null;
  const match = text.match(discourseTopicPathRe);
  if (!match) return null;
  return {
    slug: String(match[1] || '').trim(),
    topicId: String(match[2] || '').trim(),
    postNumber: match[3] ? String(match[3]).trim() : null,
  };
}

function readMeta(selectors: string[]) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const content = normalizeText((node as any).getAttribute?.('content') || (node as any).textContent || '');
    if (content) return content;
  }
  return '';
}

export function findDiscourseOpNode(): Element | null {
  const byArticle = document.querySelector("article[data-post-number='1']");
  if (byArticle) return byArticle;

  const byTopicPost = document.querySelector(".topic-post[data-post-number='1']");
  if (byTopicPost) return byTopicPost;

  const byPostId = document.querySelector('#post_1');
  if (!byPostId) return null;
  return byPostId.closest('article') || byPostId;
}

export function extractDiscourseOpOnly(baseHref: string, discourseTopicPathRe: RegExp) {
  const topic = parseDiscourseTopicPathOnPage(location.pathname, discourseTopicPathRe);
  if (!topic) return null;

  const opNode = findDiscourseOpNode();
  if (!opNode) return null;

  const cooked = opNode.querySelector('.cooked') as any;
  const contentNode = (cooked || opNode) as any;
  const content = normalizeText(contentNode?.innerHTML || '');
  const text = normalizeText(contentNode?.innerText || contentNode?.textContent || '');
  if (!content && !text) return null;

  const author =
    normalizeText(
      (opNode.querySelector('.topic-meta-data .username') as any)?.textContent ||
        (opNode.querySelector('.names .username') as any)?.textContent ||
        (opNode.querySelector('[data-user-card]') as any)?.getAttribute?.('data-user-card') ||
        '',
    ) || readMeta(["meta[name='author']", "meta[property='article:author']", "meta[property='og:article:author']"]);

  const publishedAt =
    normalizeText(
      (opNode.querySelector('time') as any)?.getAttribute?.('datetime') ||
        (opNode.querySelector('time') as any)?.textContent ||
        '',
    ) || readMeta(["meta[property='article:published_time']", "meta[name='publish_date']", "meta[name='pubdate']"]);

  const title =
    normalizeText(document.title || '') ||
    readMeta(["meta[property='og:title']", "meta[name='twitter:title']", "meta[property='title']"]);
  const markdown = htmlToMarkdownTurndown(content, baseHref) || htmlToMarkdown(content, text, baseHref);

  return {
    title,
    author,
    publishedAt,
    excerpt: '',
    contentHTML: content ? `<html><body>${content}</body></html>` : `<html><body><p>${text}</p></body></html>`,
    contentMarkdown: markdown,
    textContent: text,
  };
}
