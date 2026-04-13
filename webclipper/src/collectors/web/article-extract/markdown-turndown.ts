import TurndownService from 'turndown';
import { cleanHtmlFragment } from '@collectors/web/article-extract/html-clean';
import { normalizeText } from '@collectors/web/article-extract/url';

function pickTurndownRoot(wrapper: HTMLDivElement) {
  const directChildren = Array.from(wrapper.children || []);
  if (directChildren.length !== 1) return wrapper;
  return String(directChildren[0]?.tagName || '').toLowerCase() === 'article' ? directChildren[0] : wrapper;
}

function createTurndownService() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.addRule('syncnos-summary', {
    filter: 'summary',
    replacement(content) {
      const text = normalizeText(content);
      return text ? `\n**${text}**\n\n` : '\n';
    },
  });

  turndown.addRule('syncnos-details', {
    filter: 'details',
    replacement(content) {
      const text = normalizeText(content);
      return text ? `\n${text}\n\n` : '\n';
    },
  });

  return turndown;
}

export function htmlToMarkdownTurndown(html: unknown, baseHref: string) {
  const normalizedHtml = normalizeText(html);
  if (!normalizedHtml) return '';

  try {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = normalizedHtml;
    const root = pickTurndownRoot(wrapper);
    cleanHtmlFragment(root, baseHref);
    const markdown = createTurndownService().turndown(root as any);
    return normalizeText(markdown);
  } catch (_e) {
    return '';
  }
}
