import { replaceMathElementsWithLatexText } from '@collectors/formula-utils.ts';
import { extractTextFromSanitizedClone, htmlToMarkdown, normalizeMarkdown } from '@collectors/shared/markdown-dom.ts';
import { normalizeText as normalizeTextShared } from '@services/shared/normalize.ts';

function removeThinkingNodes(container: Element | null): Element | null {
  if (!container?.querySelectorAll) return container;
  for (const selector of ['.thinking-chain-container', '.thinking-block', "[data-direct='false']"]) {
    for (const element of Array.from(container.querySelectorAll(selector))) element.remove();
  }
  return container;
}

function removeNonContentNodes(container: Element | null): Element | null {
  if (!container?.querySelectorAll) return container;
  for (const element of Array.from(
    container.querySelectorAll(
      "button, svg, path, textarea, input, select, option, script, style, [hidden], [aria-hidden='true']",
    ),
  )) {
    element.remove();
  }
  return container;
}

function contentRoot(wrapper: Element | null): Element | null {
  if (!wrapper?.querySelector) return null;
  return wrapper.querySelector('#response-content-container') || wrapper.querySelector('.chat-assistant') || wrapper;
}

function sanitizeContentClone(wrapper: Element | null): Element | null {
  const content = contentRoot(wrapper);
  if (!content?.cloneNode) return null;
  try {
    const clone = content.cloneNode(true) as Element;
    for (const editor of Array.from(clone.querySelectorAll('.cm-content[contenteditable="false"]'))) {
      const languageContainer = editor.closest('[class*="language-"]');
      if (!languageContainer) continue;
      const pre = editor.ownerDocument.createElement('pre');
      const code = editor.ownerDocument.createElement('code');
      code.className = Array.from(languageContainer.classList).find((name) => name.startsWith('language-')) || '';
      code.textContent = Array.from(editor.querySelectorAll('.cm-line'))
        .map((line) => line.textContent || '')
        .join('\n');
      pre.append(code);
      for (const toolbar of Array.from(
        languageContainer.parentElement?.querySelectorAll('.absolute.text-xs.font-medium, .sticky') || [],
      )) {
        toolbar.remove();
      }
      languageContainer.replaceWith(pre);
    }
    removeThinkingNodes(clone);
    for (const checkbox of Array.from(clone.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]'))) {
      checkbox.replaceWith(checkbox.ownerDocument.createTextNode(checkbox.checked ? '[x] ' : '[ ] '));
    }
    for (const paragraph of Array.from(clone.querySelectorAll('p'))) {
      const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        if (node.parentElement?.closest('pre, code, .katex, math')) continue;
        const lines = String(node.textContent || '').split(/\r\n?|\n/);
        if (lines.length < 2) continue;
        const fragment = paragraph.ownerDocument.createDocumentFragment();
        lines.forEach((line, index) => {
          if (index) fragment.append(paragraph.ownerDocument.createElement('br'));
          fragment.append(line);
        });
        node.replaceWith(fragment);
      }
    }
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

function extractUserMarkdown(wrapper: Element): string {
  const content = wrapper.querySelector('.whitespace-pre-wrap');
  if (!content) return '';
  const clone = content.cloneNode(true) as Element;
  removeNonContentNodes(clone);
  return String(clone.textContent || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export default {
  removeThinkingNodes,
  removeNonContentNodes,
  normalizeMarkdown,
  htmlToMarkdown,
  extractTextFromSanitizedClone,
  extractAssistantMarkdown,
  extractAssistantText,
  extractUserMarkdown,
};
