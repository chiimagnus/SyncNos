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
    minTextLength: 240,
    urls,
  });
  if (!res?.ok) return snapshot;

  const items = Array.isArray(res?.data?.items) ? res.data.items : [];
  const best = items
    .map((x: any) => ({
      href: normalizeUrl(x?.href),
      title: String(x?.title || '').trim(),
      text: String(x?.text || '').trim(),
      html: String(x?.html || '').trim(),
      markdown: String(x?.markdown || '').trim(),
    }))
    .filter((x: any) => x.text.length >= 120)
    .sort((a: any, b: any) => b.text.length - a.text.length)[0];

  if (!best) return snapshot;

  const markdown = best.markdown || tryHtmlToMarkdown(best.html) || best.text;
  const text = best.text;

  for (const { m } of targets) {
    m.contentText = text;
    m.contentMarkdown = markdown;
  }

  return snapshot;
}
