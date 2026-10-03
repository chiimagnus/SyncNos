import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';
import { extractTextFromSanitizedClone, htmlToMarkdown } from '@collectors/shared/markdown-dom.ts';
import { normalizeText } from '@services/shared/normalize.ts';

function sanitize(node: Element | null): Element | null {
  if (!node?.cloneNode) return null;
  const clone = node.cloneNode(true) as Element;
  for (const span of Array.from(clone.querySelectorAll<HTMLSpanElement>('span.inline-code, span[style]'))) {
    const tag = span.classList.contains('inline-code') ? 'code' : span.style.fontStyle === 'italic' ? 'em' : null;
    if (!tag) continue;
    const semantic = clone.ownerDocument.createElement(tag);
    semantic.append(...span.childNodes);
    span.replaceWith(semantic);
  }
  replaceMathElementsWithLatexText(clone);
  for (const element of Array.from(
    clone.querySelectorAll(
      ".table-footer, .cdk-visually-hidden, [hidden], [hide-from-message-actions], [aria-hidden='true'], button, svg, path, textarea, input, select, option, script, style",
    ),
  )) {
    element.remove();
  }
  return clone;
}

function extractMarkdown(node: Element | null): string {
  const clone = sanitize(node);
  return clone ? htmlToMarkdown(clone) : '';
}

function extractText(node: Element | null): string {
  const clone = sanitize(node);
  return clone ? normalizeText(extractTextFromSanitizedClone(clone)) : '';
}

export default { extractMarkdown, extractText };
