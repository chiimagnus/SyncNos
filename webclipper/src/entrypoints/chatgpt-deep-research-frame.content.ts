import normalizeApi from '@services/shared/normalize.ts';
import chatgptMarkdown from '../collectors/chatgpt/chatgpt-markdown.ts';

const MESSAGE_TYPES = Object.freeze({
  REQUEST: 'SYNCNOS_DEEP_RESEARCH_REQUEST',
  RESPONSE: 'SYNCNOS_DEEP_RESEARCH_RESPONSE',
});

function isAllowedParentOrigin(origin: string): boolean {
  const value = String(origin || '').trim().toLowerCase();
  if (!value) return false;
  return value === 'https://chatgpt.com' || value === 'https://www.chatgpt.com' || value === 'https://chat.openai.com';
}

function resolveAllowedParentOrigin(eventOrigin: string): string | null {
  const rawOrigin = String(eventOrigin || '').trim();
  if (isAllowedParentOrigin(rawOrigin)) return rawOrigin;

  // Some browsers/environments may report a null/empty origin for postMessage from extension isolated worlds.
  // Fall back to verifying via `document.referrer`, which should reflect the embedding ChatGPT page.
  const ref = String(document.referrer || '').trim();
  if (!ref) return null;
  try {
    const refOrigin = new URL(ref).origin;
    if (isAllowedParentOrigin(refOrigin)) return refOrigin;
  } catch (_e) {
    // ignore
  }
  return null;
}

function normalizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickContentRoot(doc: Document): HTMLElement {
  const candidates: HTMLElement[] = [];
  const main = doc.querySelector<HTMLElement>('main') || doc.querySelector<HTMLElement>("[role='main']");
  if (main) candidates.push(main);
  doc.querySelectorAll<HTMLElement>('article').forEach((el) => candidates.push(el));
  if (doc.body) candidates.push(doc.body);

  let best: HTMLElement = doc.body || (doc.documentElement as any);
  let bestLen = 0;
  for (const el of candidates.slice(0, 24)) {
    const len = String((el as any)?.innerText || el.textContent || '').trim().length;
    if (len > bestLen) {
      bestLen = len;
      best = el;
    }
  }
  return best || doc.body || (doc.documentElement as any);
}

function extractDeepResearchSnapshot(): { title: string; markdown: string; text: string } {
  const title =
    normalizeTitle(document.querySelector('h1')?.textContent) ||
    normalizeTitle(document.title) ||
    'Deep Research';

  const root = pickContentRoot(document);
  const cloned = root?.cloneNode ? (root.cloneNode(true) as any) : null;
  if (cloned) chatgptMarkdown.removeNonContentNodes(cloned);
  const markdown = cloned ? String(chatgptMarkdown.htmlToMarkdown(cloned) || '').trim() : '';
  // `outerHTML/textContent` do not include Shadow DOM content; `innerText` often reflects the rendered/composed tree.
  // Prefer the longer one so we don't miss titles/bodies that render via shadow roots.
  const visibleText = normalizeApi.normalizeText(String((root as any)?.innerText || ''));
  const domText = normalizeApi.normalizeText(String(root?.textContent || ''));
  const text = visibleText.length >= domText.length ? visibleText : domText;

  return {
    title,
    markdown,
    text,
  };
}

export default defineContentScript({
  matches: ['https://connector_openai_deep_research.web-sandbox.oaiusercontent.com/*'],
  allFrames: true,
  main() {
    window.addEventListener('message', (event: MessageEvent) => {
      const parentOrigin = resolveAllowedParentOrigin(String(event.origin || ''));
      if (!parentOrigin) return;
      const data: any = (event as any)?.data;
      if (!data || data.__syncnos !== true) return;
      if (data.type !== MESSAGE_TYPES.REQUEST) return;

      const requestId = String(data.requestId || '').trim();
      if (!requestId) return;

      try {
        const snapshot = extractDeepResearchSnapshot();
        window.parent.postMessage(
          {
            __syncnos: true,
            type: MESSAGE_TYPES.RESPONSE,
            requestId,
            title: snapshot.title,
            markdown: snapshot.markdown,
            text: snapshot.text,
          },
          parentOrigin,
        );
      } catch (_e) {
        window.parent.postMessage(
          {
            __syncnos: true,
            type: MESSAGE_TYPES.RESPONSE,
            requestId,
            title: 'Deep Research',
            markdown: '',
            text: '',
          },
          parentOrigin,
        );
      }
    });
  },
});
