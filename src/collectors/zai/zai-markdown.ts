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
    for (const editor of Array.from(clone.querySelectorAll('.cm-content[contenteditable="false"][data-language]'))) {
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
  removeThinkingNodes,
  removeNonContentNodes,
  normalizeMarkdown,
  htmlToMarkdown,
  extractTextFromSanitizedClone,
  extractAssistantMarkdown,
  extractAssistantText,
};
