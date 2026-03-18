import { CHATGPT_MESSAGE_TYPES } from '../../platform/messaging/message-contracts';
import chatgptMarkdown from './chatgpt-markdown.ts';

type RuntimeSend = (type: string, payload?: Record<string, unknown>) => Promise<any>;

function normalizeUrl(raw: unknown): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function deepResearchHostFromUrl(urlText: string): string {
  const text = String(urlText || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const host = String(url.hostname || '').trim().toLowerCase();
    if (host === 'connector_openai_deep_research.web-sandbox.oaiusercontent.com') return host;
    if (host.endsWith('.web-sandbox.oaiusercontent.com')) return host;
  } catch (_e) {
    // ignore
  }
  return '';
}

function isDeepResearchPlaceholder(text: unknown): boolean {
  const value = String(text || '').trim();
  return value.startsWith('Deep Research (iframe):') || value === 'Deep Research (iframe)';
}

function tryHtmlToMarkdown(html: string): string {
  const value = String(html || '').trim();
  if (!value) return '';
  if (typeof document === 'undefined' || !document?.createElement) return '';
  try {
    const container = document.createElement('div');
    container.innerHTML = value;
    chatgptMarkdown.removeNonContentNodes(container);
    return String(chatgptMarkdown.htmlToMarkdown(container) || '').trim();
  } catch (_e) {
    return '';
  }
}

export async function hydrateChatgptDeepResearchSnapshot(snapshot: any, send: RuntimeSend): Promise<any> {
  if (!snapshot || !snapshot.conversation || !Array.isArray(snapshot.messages) || !snapshot.messages.length) return snapshot;
  if (String(snapshot?.conversation?.source || '').trim().toLowerCase() !== 'chatgpt') return snapshot;

  const targets = snapshot.messages
    .map((m: any, idx: number) => ({ m, idx }))
    .filter(({ m }: { m: any }) => m && m.role === 'assistant' && isDeepResearchPlaceholder(m.contentText || m.contentMarkdown));

  if (!targets.length) return snapshot;

  // Keep this low enough to capture short states like "Research stopped", but still avoid
  // hydrating placeholders with near-empty frame scaffolding.
  const minTextLength = 4;

  const urls = targets
    .map(({ m }: { m: any }) => {
      const raw = String(m.contentText || m.contentMarkdown || '');
      const prefix = 'Deep Research (iframe):';
      const extracted = raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : '';
      return normalizeUrl(extracted);
    })
    .filter(Boolean);

  const expectedHost = deepResearchHostFromUrl(urls[0] || '') || 'connector_openai_deep_research.web-sandbox.oaiusercontent.com';

  const res = await send(CHATGPT_MESSAGE_TYPES.EXTRACT_DEEP_RESEARCH, {
    expectedHost,
    // Multiple deep-research iframes often need a lower threshold to avoid dropping non-focused frames.
    minTextLength,
    urls,
  });
  if (!res?.ok) return snapshot;

  const items = Array.isArray(res?.data?.items) ? res.data.items : [];
  const normalized = items
    .map((x: any) => ({
      frameId: Number(x?.frameId),
      frameRect: x?.frameRect && typeof x.frameRect === 'object' ? x.frameRect : null,
      frameIndex: Number.isFinite(Number(x?.frameIndex)) ? Number(x?.frameIndex) : null,
      href: normalizeUrl(x?.href),
      title: String(x?.title || '').trim(),
      text: String(x?.text || '').trim(),
      html: String(x?.html || '').trim(),
      markdown: String(x?.markdown || '').trim(),
    }))
    .filter((x: any) => x.text.replace(/\s+/g, '').length >= minTextLength);

  if (!normalized.length) return snapshot;

  if (targets.length <= 1) {
    const best = normalized.slice().sort((a: any, b: any) => b.text.length - a.text.length)[0];
    if (!best) return snapshot;
    const markdown = best.markdown || tryHtmlToMarkdown(best.html) || best.text;
    const text = best.text;
    targets[0].m.contentText = text;
    targets[0].m.contentMarkdown = markdown;
    return snapshot;
  }

  const withTop = normalized
    .map((x: any) => ({
      ...x,
      top: Number(x?.frameRect?.top),
      width: Number(x?.frameRect?.width),
      height: Number(x?.frameRect?.height),
    }))
    .filter((x: any) => Number.isFinite(x.top));

  // If we can't determine per-frame ordering, avoid incorrectly hydrating all placeholders with the same report.
  if (withTop.length < 2) {
    const best = normalized.slice().sort((a: any, b: any) => b.text.length - a.text.length)[0];
    if (!best) return snapshot;
    const markdown = best.markdown || tryHtmlToMarkdown(best.html) || best.text;
    const text = best.text;
    targets[0].m.contentText = text;
    targets[0].m.contentMarkdown = markdown;
    return snapshot;
  }

  // Map frames to placeholders by vertical order. This avoids collapsing multiple reports into a single "best" report.
  const sortedItems = withTop
    .slice()
    // Drop clearly non-visible frames (some turns keep a stale iframe in the DOM with 0 height).
    .filter((x: any) => !(Number.isFinite(x.width) && Number.isFinite(x.height)) || (x.width > 20 && x.height > 20))
    // Prefer stable DOM-order indices assigned on the parent page when available.
    .sort((a: any, b: any) => {
      const ai = a.frameIndex;
      const bi = b.frameIndex;
      const aHas = Number.isFinite(ai);
      const bHas = Number.isFinite(bi);
      if (aHas && bHas) return Number(ai) - Number(bi);
      if (aHas) return -1;
      if (bHas) return 1;
      // Fallback: when `top` ties (common with stale/duplicated iframes), use `frameId` as a stable tie-breaker.
      return (a.top - b.top) || (Number(a.frameId) - Number(b.frameId));
    });

  // Deduplicate items that share the same on-page position and identical content (ChatGPT can keep a stale duplicate iframe).
  const dedupedItems: any[] = [];
  const seen = new Set<string>();
  for (const item of sortedItems) {
    // Do not include `top` in the key; duplicates can appear at different positions.
    const key = `${item.href}|${item.title.slice(0, 96)}|${item.text.slice(0, 512)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedItems.push(item);
  }

  const sortedTargets = targets.slice().sort((a: any, b: any) => a.idx - b.idx);
  const n = Math.min(sortedTargets.length, dedupedItems.length);
  for (let i = 0; i < n; i += 1) {
    const best = dedupedItems[i];
    const markdown = best.markdown || tryHtmlToMarkdown(best.html) || best.text;
    const text = best.text;
    sortedTargets[i].m.contentText = text;
    sortedTargets[i].m.contentMarkdown = markdown;
  }

  return snapshot;
}
