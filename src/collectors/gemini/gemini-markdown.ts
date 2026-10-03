import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';
import { extractTextFromSanitizedClone, htmlToMarkdown, normalizeMarkdown } from '@collectors/shared/markdown-dom.ts';
import { normalizeText as normalizeTextShared } from '@services/shared/normalize.ts';

function removeNonContentNodes(container: Element | null): Element | null {
  if (!container?.querySelectorAll) return container;
  for (const element of Array.from(
    container.querySelectorAll(
      ".table-footer, .cdk-visually-hidden, [hidden], [hide-from-message-actions], [aria-hidden='true'], svg, path, textarea, input, select, option, script, style",
    ),
  )) {
    element.remove();
  }
  return container;
}

function getAssistantContentRoot(wrapper: Element | null): Element | null {
  if (!wrapper) return null;
  const selectors = [
    "div.markdown.markdown-main-panel[inline-copy-host][id^='model-response-message-content']",
    'div.markdown.markdown-main-panel[inline-copy-host]',
    'div.markdown-main-panel.preserve-whitespaces-in-response',
    'div.markdown.markdown-main-panel',
    'model-response .model-response-text',
    '.model-response-text',
  ];
  for (const selector of selectors) {
    const node = wrapper.querySelector?.(selector);
    if (node) return node;
  }
  return wrapper.classList?.contains('markdown-main-panel') ? wrapper : wrapper;
}

function annotateCodeLanguages(container: Element): void {
  for (const block of Array.from(container.querySelectorAll('code-block'))) {
    const code = block.querySelector('pre code');
    const label = String(block.querySelector('.code-block-decoration span')?.textContent || '').trim();
    if (!code || !/^[a-z0-9_#+.-]{1,40}$/i.test(label)) continue;
    const className = String(code.getAttribute('class') || '');
    if (/(^|\s)(?:language|lang)-[a-z0-9_#+.-]+/i.test(className)) continue;
    code.classList.add(`language-${label.toLowerCase()}`);
  }
}

function sanitizeContentClone(wrapper: Element | null): Element | null {
  const root = getAssistantContentRoot(wrapper);
  if (!root?.cloneNode) return null;
  try {
    const clone = root.cloneNode(true) as Element;
    annotateCodeLanguages(clone);
    replaceMathElementsWithLatexText(clone);
    removeNonContentNodes(clone);
    return clone;
  } catch (_error) {
    return null;
  }
}

function extractAssistantMarkdown(wrapper: Element | null): string {
  const clone = sanitizeContentClone(wrapper);
  return clone ? htmlToMarkdown(clone) : '';
}

function extractAssistantText(wrapper: Element | null): string {
  const clone = sanitizeContentClone(wrapper);
  return clone ? normalizeTextShared(extractTextFromSanitizedClone(clone)) : '';
}

export default {
  removeNonContentNodes,
  normalizeMarkdown,
  extractTextFromSanitizedClone,
  htmlToMarkdown,
  extractAssistantMarkdown,
  extractAssistantText,
};
