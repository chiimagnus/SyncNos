import { findTextQuoteInText, normalizeTextQuoteSelector, type TextQuoteSelector } from './text-quote-selector';

function isSkippableElement(node: Node | null): boolean {
  if (!node || node.nodeType !== 1) return false;
  const tag = String((node as Element).tagName || '').toLowerCase();
  return tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'textarea' || tag === 'input';
}

function* walkTextNodes(root: Node): Generator<Text, void, unknown> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parent = node?.parentNode;
      if (isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
      const value = String((node as any).nodeValue || '');
      if (!value) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  } as any);
  let current = walker.nextNode();
  while (current) {
    yield current as Text;
    current = walker.nextNode();
  }
}

export function findTextQuoteRange(selectorInput: TextQuoteSelector | null): Range | null {
  const selector = normalizeTextQuoteSelector(selectorInput);
  if (!selector) return null;
  const root = document.body;
  if (!root) return null;

  const chunks: Array<{ node: Text; start: number; end: number }> = [];
  let combined = '';
  for (const node of walkTextNodes(root)) {
    const value = String(node.nodeValue || '');
    const start = combined.length;
    combined += value;
    const end = combined.length;
    chunks.push({ node, start, end });
    if (combined.length > 2_000_000) break; // safety cap
  }

  const match = findTextQuoteInText(combined, selector);
  if (!match) return null;

  const startChunk = chunks.find((c) => match.start >= c.start && match.start <= c.end) || null;
  const endChunk = chunks.find((c) => match.end >= c.start && match.end <= c.end) || null;
  if (!startChunk || !endChunk) return null;

  const range = document.createRange();
  range.setStart(startChunk.node, Math.max(0, match.start - startChunk.start));
  range.setEnd(endChunk.node, Math.max(0, match.end - endChunk.start));
  return range;
}

export function locateAndFlashTextQuote(selector: TextQuoteSelector | null): boolean {
  const range = findTextQuoteRange(selector);
  if (!range) return false;

  try {
    const rect = range.getBoundingClientRect();
    const top = Math.max(0, rect.top + window.scrollY - window.innerHeight * 0.3);
    window.scrollTo({ top, behavior: 'smooth' });
  } catch (_e) {
    try {
      (range.startContainer as any)?.parentElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    } catch (_e2) {
      // ignore
    }
  }

  try {
    const overlayId = 'webclipper-inpage-comment-highlight';
    const existing = document.getElementById(overlayId);
    existing?.remove?.();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483646';

    const rects = Array.from(range.getClientRects());
    for (const r of rects.slice(0, 8)) {
      const box = document.createElement('div');
      box.style.position = 'fixed';
      box.style.left = `${Math.max(0, r.left)}px`;
      box.style.top = `${Math.max(0, r.top)}px`;
      box.style.width = `${Math.max(1, r.width)}px`;
      box.style.height = `${Math.max(1, r.height)}px`;
      box.style.borderRadius = '6px';
      box.style.background = 'rgba(255, 198, 173, 0.35)';
      box.style.outline = '2px solid rgba(255, 198, 173, 0.85)';
      box.style.outlineOffset = '1px';
      overlay.appendChild(box);
    }

    document.documentElement.appendChild(overlay);
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  } catch (_e) {
    // ignore highlight failures
  }

  return true;
}
