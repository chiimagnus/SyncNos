import TurndownService from 'turndown';
import { gfm as applyTurndownGfm } from 'turndown-plugin-gfm';
import { cleanHtmlFragment } from '@collectors/web/article-extract/html-clean';
import { normalizeText } from '@collectors/web/article-extract/url';

function pickTurndownRoot(wrapper: HTMLDivElement) {
  const directChildren = Array.from(wrapper.children || []);
  if (directChildren.length !== 1) return wrapper;
  return String(directChildren[0]?.tagName || '').toLowerCase() === 'article' ? directChildren[0] : wrapper;
}

function normalizeFenceLanguage(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  const cleaned = normalized.replace(/[^a-z0-9+.#_-]/g, '');
  if (!cleaned) return '';
  if (cleaned === 'auto' || cleaned === 'text' || cleaned === 'plain' || cleaned === 'plaintext') return '';
  return cleaned;
}

function detectCodeLanguageFromClassName(value: unknown) {
  const className = normalizeText(value);
  if (!className) return '';

  const patterns = [
    /(?:^|\s)language-([a-z0-9+.#_-]+)(?:\s|$)/i,
    /(?:^|\s)lang-([a-z0-9+.#_-]+)(?:\s|$)/i,
    /(?:^|\s)highlight-source-([a-z0-9+.#_-]+)(?:\s|$)/i,
  ];
  for (const pattern of patterns) {
    const match = className.match(pattern);
    if (!match || !match[1]) continue;
    const language = normalizeFenceLanguage(match[1]);
    if (language) return language;
  }
  return '';
}

function detectCodeLanguage(pre: HTMLElement, code: Element | null) {
  const candidates = [
    normalizeFenceLanguage(code?.getAttribute?.('data-language') || ''),
    normalizeFenceLanguage(code?.getAttribute?.('data-lang') || ''),
    normalizeFenceLanguage(code?.getAttribute?.('lang') || ''),
    detectCodeLanguageFromClassName(code?.getAttribute?.('class') || ''),
    normalizeFenceLanguage(pre?.getAttribute?.('data-language') || ''),
    normalizeFenceLanguage(pre?.getAttribute?.('data-lang') || ''),
    normalizeFenceLanguage(pre?.getAttribute?.('lang') || ''),
    detectCodeLanguageFromClassName(pre?.getAttribute?.('class') || ''),
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return '';
}

function createTurndownService() {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  applyTurndownGfm(turndown);

  function isInsideTable(node: Node | null): boolean {
    const el = node && (node as any).nodeType === 1 ? (node as Element) : null;
    if (!el || typeof (el as any).closest !== 'function') return false;
    return Boolean((el as any).closest('table,thead,tbody,tfoot,tr,td,th'));
  }

  function collapseTableCellText(value: string) {
    return normalizeText(value).replace(/\s+/g, ' ');
  }

  turndown.addRule('syncnos-table-section', {
    filter(node) {
      const name = String((node as any)?.nodeName || '').toLowerCase();
      if (name !== 'section') return false;
      return isInsideTable(node);
    },
    replacement(content) {
      const text = collapseTableCellText(content);
      return text ? ` ${text} ` : ' ';
    },
  });

  turndown.addRule('syncnos-table-br', {
    filter(node) {
      const name = String((node as any)?.nodeName || '').toLowerCase();
      if (name !== 'br') return false;
      return isInsideTable(node);
    },
    replacement() {
      return ' ';
    },
  });

  turndown.addRule('syncnos-pre', {
    filter: 'pre',
    replacement(_content, node) {
      const pre = node as HTMLElement;
      const code = pre?.querySelector?.('code');
      const language = detectCodeLanguage(pre, code);
      const value = String(code?.textContent || pre?.textContent || '')
        .replace(/\r\n/g, '\n')
        .trim();
      if (!value) return '\n';
      const fence = language ? `\`\`\`${language}` : '```';
      return `\n${fence}\n${value}\n\`\`\`\n\n`;
    },
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
