import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';
import { extractTextFromSanitizedClone, htmlToMarkdown } from '@collectors/shared/markdown-dom.ts';
import { normalizeText } from '@services/shared/normalize.ts';

function sanitize(node: Element | null): Element | null {
  if (!node?.cloneNode) return null;
  const clone = node.cloneNode(true) as Element;
  replaceMathElementsWithLatexText(clone);
  for (const element of Array.from(
    clone.querySelectorAll(
      "button, svg, path, textarea, input, select, option, script, style, [hidden], [aria-hidden='true']",
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
