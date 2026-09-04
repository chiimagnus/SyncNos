import Defuddle from 'defuddle';
import { normalizeText } from '@collectors/web/article-extract/url';

type DefuddleArticlePayload = {
  title: string;
  author: string;
  publishedAt: string;
  excerpt: string;
  contentHTML: string;
  textContent: string;
};

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(content: unknown, text: unknown) {
  const normalizedContent = normalizeText(content);
  if (normalizedContent) {
    if (/^\s*<html[\s>]/i.test(normalizedContent)) return normalizedContent;
    return `<html><body>${normalizedContent}</body></html>`;
  }
  const normalizedText = normalizeText(text);
  return `<html><body><p>${escapeHtml(normalizedText)}</p></body></html>`;
}

function pickTextFromHtml(content: string) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = content;
  return normalizeText((wrapper as any).innerText || wrapper.textContent || '');
}

function normalizeTitleText(value: unknown) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function pickSemanticTitleFromContent(content: string) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = content;
  const heading = wrapper.querySelector?.('h1,h2');
  const candidate = normalizeTitleText(heading?.textContent || '');
  if (!candidate || typeof document.querySelectorAll !== 'function') return '';

  const pageH1s = Array.from(document.querySelectorAll('h1'));
  return pageH1s.some((node) => normalizeTitleText(node.textContent || '') === candidate) ? candidate : '';
}

export function extractByDefuddle(baseHref: string): DefuddleArticlePayload | null {
  try {
    const cloned = document.cloneNode(true) as Document;
    const parser = new Defuddle(cloned, {
      url: baseHref,
      markdown: false,
      separateMarkdown: false,
      useAsync: false,
      includeReplies: 'extractors',
    });
    const parsed = parser.parse();
    if (!parsed) return null;

    const content = normalizeText(parsed.content || '');
    const text = content ? pickTextFromHtml(content) : '';
    if (!content && !text) return null;

    return {
      title: pickSemanticTitleFromContent(content) || normalizeText(parsed.title || document.title || ''),
      author: normalizeText(parsed.author || ''),
      publishedAt: normalizeText(parsed.published || ''),
      excerpt: normalizeText(parsed.description || ''),
      contentHTML: buildHtml(content, text),
      textContent: text,
    };
  } catch (_e) {
    return null;
  }
}
