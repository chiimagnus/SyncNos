import { storageGet, storageSet } from '../../platform/storage/local';
import { formatConversationMarkdown } from '../../conversations/domain/markdown';
import { buildConversationBasename } from '../../conversations/domain/file-naming';
import { getImageCacheAssetById } from '../../conversations/data/image-cache-read';
import type { Conversation, ConversationDetail } from '../../conversations/domain/models';

export type ChatWithAiPlatform = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

export type ChatWithSettings = {
  promptTemplate: string;
  platforms: ChatWithAiPlatform[];
  maxChars: number;
};

export const CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY = 'chat_with_prompt_template_v1';
export const CHAT_WITH_PLATFORMS_STORAGE_KEY = 'chat_with_ai_platforms_v1';
export const CHAT_WITH_MAX_CHARS_STORAGE_KEY = 'chat_with_max_chars_v1';

export const DEFAULT_CHAT_WITH_MAX_CHARS = 28_000;

export const DEFAULT_CHAT_WITH_PROMPT_TEMPLATE = [
  '和我聊聊这个内容说了什么。',
  '',
  'Title: {{article_title}}',
  'URL: {{article_url}}',
  '',
  '{{article_content}}',
].join('\n');

export const DEFAULT_CHAT_WITH_PLATFORMS: ChatWithAiPlatform[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', enabled: false },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', enabled: false },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', enabled: false },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', enabled: false },
  { id: 'doubao', name: 'Doubao', url: 'https://www.doubao.com/', enabled: false },
  { id: 'yuanbao', name: 'Yuanbao', url: 'https://yuanbao.tencent.com/', enabled: false },
  { id: 'poe', name: 'Poe', url: 'https://poe.com/', enabled: false },
  { id: 'notionai', name: 'NotionAI', url: 'https://www.notion.so/', enabled: false },
  { id: 'zai', name: 'z.ai', url: 'https://z.ai/', enabled: false },
  { id: 'googleaistudio', name: 'Google AI Studio', url: 'https://aistudio.google.com/', enabled: false },
];

const INTERNAL_IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeHttpUrl(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = String(url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function sanitizePlatformId(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return '';
  // Keep a stable, URL-safe-ish id.
  const cleaned = value.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');
  return cleaned;
}

function coercePlatform(value: any): ChatWithAiPlatform | null {
  const id = sanitizePlatformId(value?.id);
  const name = String(value?.name ?? '').trim();
  const url = normalizeHttpUrl(value?.url);
  const enabled = !!value?.enabled;
  if (!id || !name || !url) return null;
  return { id, name, url, enabled };
}

function withDefaults(input: Partial<ChatWithSettings>): ChatWithSettings {
  const promptTemplate = isNonEmptyString(input.promptTemplate)
    ? String(input.promptTemplate)
    : DEFAULT_CHAT_WITH_PROMPT_TEMPLATE;

  const maxCharsRaw = Number((input as any).maxChars);
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 500 ? Math.floor(maxCharsRaw) : DEFAULT_CHAT_WITH_MAX_CHARS;

  const platformsInput = Array.isArray(input.platforms) ? input.platforms : [];
  const parsed = platformsInput.map(coercePlatform).filter(Boolean) as ChatWithAiPlatform[];

  const list = parsed.length ? parsed : DEFAULT_CHAT_WITH_PLATFORMS.slice();
  const map = new Map<string, ChatWithAiPlatform>();
  for (const p of list) {
    if (!p || !p.id) continue;
    if (map.has(p.id)) continue;
    map.set(p.id, p);
  }

  return {
    promptTemplate,
    maxChars,
    platforms: Array.from(map.values()),
  };
}

export async function loadChatWithSettings(): Promise<ChatWithSettings> {
  try {
    const res = await storageGet([
      CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY,
      CHAT_WITH_PLATFORMS_STORAGE_KEY,
      CHAT_WITH_MAX_CHARS_STORAGE_KEY,
    ]);

    const promptTemplate = isNonEmptyString(res?.[CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY])
      ? String(res[CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY])
      : DEFAULT_CHAT_WITH_PROMPT_TEMPLATE;

    const maxCharsRaw = Number(res?.[CHAT_WITH_MAX_CHARS_STORAGE_KEY]);
    const maxChars =
      Number.isFinite(maxCharsRaw) && maxCharsRaw > 500 ? Math.floor(maxCharsRaw) : DEFAULT_CHAT_WITH_MAX_CHARS;

    const platformsRaw = res?.[CHAT_WITH_PLATFORMS_STORAGE_KEY];
    let platforms: ChatWithAiPlatform[] = [];
    if (Array.isArray(platformsRaw)) {
      platforms = platformsRaw.map(coercePlatform).filter(Boolean) as ChatWithAiPlatform[];
    }

    return withDefaults({ promptTemplate, platforms, maxChars });
  } catch (_e) {
    return withDefaults({});
  }
}

export async function saveChatWithSettings(settings: ChatWithSettings): Promise<void> {
  const normalized = withDefaults(settings || ({} as any));
  await storageSet({
    [CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY]: String(normalized.promptTemplate || ''),
    [CHAT_WITH_MAX_CHARS_STORAGE_KEY]: Math.floor(Number(normalized.maxChars) || DEFAULT_CHAT_WITH_MAX_CHARS),
    [CHAT_WITH_PLATFORMS_STORAGE_KEY]: normalized.platforms.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      enabled: !!p.enabled,
    })),
  });
}

export async function resetChatWithSettings(): Promise<void> {
  await storageSet({
    [CHAT_WITH_PROMPT_TEMPLATE_STORAGE_KEY]: DEFAULT_CHAT_WITH_PROMPT_TEMPLATE,
    [CHAT_WITH_MAX_CHARS_STORAGE_KEY]: DEFAULT_CHAT_WITH_MAX_CHARS,
    [CHAT_WITH_PLATFORMS_STORAGE_KEY]: DEFAULT_CHAT_WITH_PLATFORMS,
  });
}

function getConversationUrl(conversation: Conversation): string {
  const raw = String(conversation?.url || '').trim();
  return raw;
}

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

function normalizeImageExt(raw: unknown): string {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return 'png';
  if (text === 'jpeg') return 'jpg';
  if (text === 'svg+xml') return 'svg';
  if (text === 'x-icon' || text === 'vnd.microsoft.icon') return 'ico';
  return /^[a-z0-9]+$/.test(text) ? text : 'png';
}

function inferImageExtFromSource(input: { contentType?: string; url?: string }): string {
  const contentType = String(input.contentType || '').trim().toLowerCase();
  if (contentType.startsWith('image/')) {
    return normalizeImageExt(contentType.slice('image/'.length));
  }

  const text = String(input.url || '').trim();
  if (!text) return 'png';
  if (isDataImageUrl(text)) {
    const matched = /^data:image\/([a-z0-9.+-]+)/i.exec(text);
    return normalizeImageExt(matched?.[1] || '');
  }
  try {
    const u = new URL(text);
    const pathname = String(u.pathname || '');
    const last = pathname.split('/').filter(Boolean).pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot >= 0 && dot < last.length - 1) return normalizeImageExt(last.slice(dot + 1));
  } catch (_e) {
    // ignore parse failure, fallback below
  }
  return 'png';
}

async function inferMaterializedImageExt(url: string): Promise<string> {
  const text = String(url || '').trim();
  const assetId = parseSyncnosAssetId(text);
  if (!assetId) {
    return inferImageExtFromSource({ url: text });
  }
  const asset = await getImageCacheAssetById({ id: assetId });
  if (!asset) return 'png';
  return inferImageExtFromSource({ contentType: asset.contentType, url: asset.url });
}

export async function materializeMarkdownAssetPaths(input: { markdown: string; markdownBasename: string }): Promise<string> {
  const markdown = String(input.markdown || '');
  if (!markdown) return '';

  const basename = String(input.markdownBasename || '').trim() || 'conversation';
  const orderedUrls: string[] = [];
  const seenUrls = new Set<string>();

  INTERNAL_IMAGE_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = INTERNAL_IMAGE_REF_RE.exec(markdown)) != null) {
    const urlPart = match[2] ? String(match[2]) : '';
    const url = stripAngleBrackets(urlPart);
    const shouldMaterialize = isDataImageUrl(url) || parseSyncnosAssetId(url) != null;
    if (!shouldMaterialize) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    orderedUrls.push(url);
  }
  if (!orderedUrls.length) return markdown;

  const replacements = new Map<string, string>();
  for (let i = 0; i < orderedUrls.length; i += 1) {
    const url = orderedUrls[i]!;
    // eslint-disable-next-line no-await-in-loop
    const ext = await inferMaterializedImageExt(url);
    replacements.set(url, `${basename}-${i + 1}.${ext}`);
  }

  INTERNAL_IMAGE_REF_RE.lastIndex = 0;
  return markdown.replace(INTERNAL_IMAGE_REF_RE, (_full, altRaw, urlPartRaw, titleRaw) => {
    const alt = altRaw ? String(altRaw) : '';
    const urlPart = urlPartRaw ? String(urlPartRaw) : '';
    const title = titleRaw ? String(titleRaw) : '';
    const url = stripAngleBrackets(urlPart);
    const shouldMaterialize = isDataImageUrl(url) || parseSyncnosAssetId(url) != null;
    if (!shouldMaterialize) return _full;

    const materialized = replacements.get(url);
    if (!materialized) return _full;
    const nextPart = urlPart.trim().startsWith('<') ? `<${materialized}>` : materialized;
    return `![${alt}](${nextPart}${title})`;
  });
}

export async function formatConversationMarkdownForExternalOutput(
  conversation: Conversation,
  detail: ConversationDetail,
): Promise<string> {
  const raw = formatConversationMarkdown(conversation, (detail?.messages || []) as any);
  const basename = buildConversationBasename(conversation as any);
  return materializeMarkdownAssetPaths({ markdown: raw, markdownBasename: basename });
}

async function getArticleContent(conversation: Conversation, detail: ConversationDetail): Promise<string> {
  const sourceType = String(conversation?.sourceType || '').trim().toLowerCase();
  if (sourceType !== 'article') {
    return formatConversationMarkdownForExternalOutput(conversation, detail);
  }

  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const primary = messages[0] as any;
  const markdown = String(primary?.contentMarkdown || primary?.contentText || '');
  const basename = buildConversationBasename(conversation as any);
  return materializeMarkdownAssetPaths({ markdown, markdownBasename: basename });
}

export function renderChatWithTemplate(template: string, vars: Record<string, string>): string {
  let out = String(template ?? '');

  for (const [key, value] of Object.entries(vars || {})) {
    const v = String(value ?? '');
    // {{key}}
    out = out.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), v);
    // word-boundary key (matches spec's `article_content` style)
    out = out.replace(new RegExp(`\\b${key}\\b`, 'g'), v);
  }

  return out;
}

export function truncateForChatWith(input: string, maxChars: number): { text: string; truncated: boolean } {
  const text = String(input || '');
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1, Math.floor(Number(maxChars))) : DEFAULT_CHAT_WITH_MAX_CHARS;
  if (text.length <= limit) return { text, truncated: false };
  const suffix = `\n\n[Truncated: original length=${text.length}]`;
  const sliceLen = Math.max(0, limit - suffix.length);
  return { text: `${text.slice(0, sliceLen)}${suffix}`, truncated: true };
}

export async function buildChatWithPayload(
  conversation: Conversation,
  detail: ConversationDetail,
  promptTemplate: string,
): Promise<string> {
  const articleContent = await getArticleContent(conversation, detail);
  const conversationMarkdown = await formatConversationMarkdownForExternalOutput(conversation, detail);
  const vars: Record<string, string> = {
    article_title: String(conversation?.title || ''),
    article_url: getConversationUrl(conversation),
    article_content: articleContent,
    conversation_markdown: conversationMarkdown,
  };

  const rendered = renderChatWithTemplate(String(promptTemplate || ''), vars);
  // Ensure the payload always ends with a newline so platforms that auto-append continue cleanly.
  return `${rendered}\n`;
}
