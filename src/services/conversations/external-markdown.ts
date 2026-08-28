import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { formatConversationMarkdown } from '@services/conversations/domain/markdown';

const INTERNAL_IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function stripAngleBrackets(url: string): string {
  const text = String(url || '').trim();
  if (text.startsWith('<') && text.endsWith('>')) return text.slice(1, -1).trim();
  return text;
}

function isDataImageUrl(url: unknown): boolean {
  const text = String(url || '').trim();
  if (!text) return false;
  return /^data:image\/[a-z0-9.+-]+(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.test(text);
}

function parseSyncnosAssetId(url: unknown): number | null {
  const text = String(url || '').trim();
  const matched = /^syncnos-asset:\/\/(\d+)$/i.exec(text);
  if (!matched) return null;
  const id = Number(matched[1]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function materializeMarkdownAssetPlaceholders(input: { markdown: string }): string {
  const markdown = String(input.markdown || '');
  if (!markdown) return '';

  INTERNAL_IMAGE_REF_RE.lastIndex = 0;
  return markdown.replace(INTERNAL_IMAGE_REF_RE, (_full, altRaw, urlPartRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const url = stripAngleBrackets(urlPart);
    const shouldReplace = isDataImageUrl(url) || parseSyncnosAssetId(url) != null;
    if (!shouldReplace) return _full;

    const label = alt && alt.trim() ? `Image: ${alt.trim()}` : 'Image omitted';
    return `[${label}]`;
  });
}

export async function formatConversationMarkdownForExternalOutput(
  conversation: Conversation,
  detail: ConversationDetail,
): Promise<string> {
  const raw = formatConversationMarkdown(conversation, (detail?.messages || []) as any);
  return materializeMarkdownAssetPlaceholders({ markdown: raw });
}
