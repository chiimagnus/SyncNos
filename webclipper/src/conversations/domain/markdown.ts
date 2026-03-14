import type { Conversation, ConversationMessage } from './models';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function formatIso(ts?: number) {
  const t = Number(ts) || 0;
  if (!t) return '';
  try {
    return new Date(t).toISOString();
  } catch (_e) {
    return String(ts || '');
  }
}

function decodeBackslashEscapes(value: string): string {
  return String(value || '')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function decodeHtmlEntities(value: string): string {
  let text = String(value || '');
  for (let step = 0; step < 4; step += 1) {
    const next = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
        const code = Number.parseInt(hex, 16);
        if (!Number.isFinite(code) || code <= 0) return _m;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _m;
        }
      })
      .replace(/&#([0-9]+);/g, (_m, dec: string) => {
        const code = Number.parseInt(dec, 10);
        if (!Number.isFinite(code) || code <= 0) return _m;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _m;
        }
      });
    if (next === text) return text;
    text = next;
  }
  return text;
}

function stripHtmlTags(value: string): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[^>]+>/g, '');
}

function normalizeSingleLine(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeArticleDescription(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const decodedEscapes = decodeBackslashEscapes(raw);
  const decodedEntities = decodeHtmlEntities(decodedEscapes);
  const stripped = stripHtmlTags(decodedEntities);
  return normalizeSingleLine(stripped);
}

export function sanitizeFilenamePart(value: unknown, fallback: string, maxLen: number = 80) {
  const raw = String(value ?? '').trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = Number.isFinite(Number(maxLen)) ? Math.max(1, Math.floor(Number(maxLen))) : 80;
  return cleaned.slice(0, limit) || fallback;
}

function formatArticleMarkdown(conversation: Conversation, messages: ConversationMessage[]) {
  const c = conversation || ({} as any);
  const m0 = Array.isArray(messages) && messages.length ? messages[0] : null;
  const lines: string[] = [];
  lines.push(`# ${c.title || 'Untitled'}`);
  lines.push('');
  if (isNonEmptyString(c.author)) lines.push(`- Author: ${String(c.author)}`);
  if (isNonEmptyString(c.publishedAt)) lines.push(`- Published: ${String(c.publishedAt)}`);
  if (isNonEmptyString(c.url)) lines.push(`- URL: ${String(c.url)}`);
  const description = sanitizeArticleDescription(c.description);
  if (isNonEmptyString(description)) lines.push(`- Description: ${description}`);
  lines.push('');
  lines.push('## Content');
  lines.push('');
  lines.push(String((m0 && ((m0 as any).contentMarkdown || (m0 as any).contentText)) || ''));
  lines.push('');
  return lines.join('\n');
}

function formatChatMarkdown(conversation: Conversation, messages: ConversationMessage[]) {
  const c = conversation || ({} as any);
  const lines: string[] = [];
  lines.push(`# ${c.title || '(untitled)'}`);
  lines.push('');
  lines.push(`- Source: ${String((c as any).sourceName || c.source || '')}`);
  if (isNonEmptyString(c.url)) lines.push(`- URL: ${String(c.url)}`);
  if (c.lastCapturedAt) lines.push(`- CapturedAt: ${formatIso(c.lastCapturedAt)}`);
  if (Array.isArray(c.warningFlags) && c.warningFlags.length) {
    lines.push(`- Warnings: ${c.warningFlags.map(String).join(', ')}`);
  }
  lines.push('');
  for (const m of messages || []) {
    const role = (m as any).role || 'assistant';
    lines.push(`## ${role}`);
    lines.push('');
    lines.push(String((m as any).contentMarkdown || (m as any).contentText || ''));
    lines.push('');
  }
  return lines.join('\n');
}

export function formatConversationMarkdown(conversation: Conversation, messages: ConversationMessage[]) {
  const sourceType = conversation?.sourceType ? String(conversation.sourceType) : '';
  if (sourceType === 'article') return formatArticleMarkdown(conversation, messages);
  return formatChatMarkdown(conversation, messages);
}
