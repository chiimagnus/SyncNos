import type { Conversation, ConversationMessage } from '@services/conversations/domain/models';
import { formatVideoChaptersMarkdown } from '@services/conversations/domain/video-content';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type FormatConversationMarkdownOptions = {
  /**
   * Heading level used for per-message role labels in chat conversations.
   * Defaults to 2 to keep message sections under the document title.
   */
  chatMessageHeadingLevel?: MarkdownHeadingLevel;
  /**
   * Heading level used for the "Content" section in article conversations.
   * Defaults to 2 to keep the section under the document title.
   */
  articleContentHeadingLevel?: MarkdownHeadingLevel;
};

type FormatVideoContentMarkdownOptions = {
  includeTranscriptHeading?: boolean;
};

function clampHeadingLevel(level: unknown, fallback: MarkdownHeadingLevel): MarkdownHeadingLevel {
  const n = Number(level);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 1) return 1;
  if (n >= 6) return 6;
  return Math.floor(n) as MarkdownHeadingLevel;
}

function headingPrefix(level: MarkdownHeadingLevel) {
  return '#'.repeat(level);
}

function formatIso(ts?: number) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    return new Date(t).toISOString();
  } catch (_e) {
    return '';
  }
}

export function sanitizeFilenamePart(value: unknown, fallback: string, maxLen: number = 80) {
  const raw = String(value ?? '').trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  const limit = Number.isFinite(Number(maxLen)) ? Math.max(1, Math.floor(Number(maxLen))) : 80;
  return cleaned.slice(0, limit) || fallback;
}

function formatArticleMarkdown(
  conversation: Conversation,
  messages: ConversationMessage[],
  options: FormatConversationMarkdownOptions,
) {
  const c = conversation || ({} as any);
  const m0 = Array.isArray(messages) && messages.length ? messages[0] : null;
  const lines: string[] = [];
  lines.push(`# ${c.title || 'Untitled'}`);
  lines.push('');
  if (isNonEmptyString(c.author)) lines.push(`- Author: ${String(c.author)}`);
  if (isNonEmptyString(c.publishedAt)) lines.push(`- Published: ${String(c.publishedAt)}`);
  if (isNonEmptyString(c.url)) lines.push(`- URL: ${String(c.url)}`);
  const lastActivityAt = formatIso(c.lastActivityAt);
  if (lastActivityAt) lines.push(`- Last Activity: ${lastActivityAt}`);
  lines.push('');
  const contentHeadingLevel = clampHeadingLevel(options.articleContentHeadingLevel, 2);
  lines.push(`${headingPrefix(contentHeadingLevel)} Content`);
  lines.push('');
  lines.push(String((m0 && (m0 as any).contentMarkdown) || ''));
  lines.push('');
  return lines.join('\n');
}

export function formatVideoContentMarkdown(
  conversation: Conversation,
  messages: ConversationMessage[],
  options: FormatVideoContentMarkdownOptions = {},
) {
  const transcript = (messages || []).find((message) => message?.messageKey === 'video_transcript') || null;
  const sections: string[] = [];
  const description = isNonEmptyString(conversation?.videoDescription)
    ? String(conversation.videoDescription).trim()
    : '';
  if (description) sections.push(`## Description\n\n${description}`);

  const chapters = Array.isArray(transcript?.videoChapters) ? transcript.videoChapters : [];
  if (chapters.length) sections.push(formatVideoChaptersMarkdown(chapters));

  const transcriptBody = String(transcript?.contentMarkdown || '');
  if (transcriptBody) {
    if (options.includeTranscriptHeading === false) sections.push(transcriptBody);
    else sections.push(`## Transcript\n\n${transcriptBody}`);
  }
  return sections.join('\n\n').trim();
}

function formatVideoMarkdown(conversation: Conversation, messages: ConversationMessage[]) {
  const c = conversation || ({} as any);
  const lines: string[] = [`# ${c.title || 'Untitled'}`, ''];
  if (isNonEmptyString(c.platform)) lines.push(`- Platform: ${String(c.platform)}`);
  if (isNonEmptyString(c.author)) lines.push(`- Author: ${String(c.author)}`);
  const durationSeconds = c.durationSeconds == null ? null : Number(c.durationSeconds);
  if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    lines.push(`- Duration: ${durationSeconds}s`);
  }
  if (isNonEmptyString(c.thumbnailUrl)) lines.push(`- Thumbnail: ${String(c.thumbnailUrl)}`);
  if (isNonEmptyString(c.url)) lines.push(`- URL: ${String(c.url)}`);
  const lastActivityAt = formatIso(c.lastActivityAt);
  if (lastActivityAt) lines.push(`- Last Activity: ${lastActivityAt}`);
  lines.push('');
  lines.push(formatVideoContentMarkdown(c, messages));
  lines.push('');
  return lines.join('\n');
}

function formatChatMarkdown(
  conversation: Conversation,
  messages: ConversationMessage[],
  options: FormatConversationMarkdownOptions,
) {
  const c = conversation || ({} as any);
  const lines: string[] = [];
  lines.push(`# ${c.title || '(untitled)'}`);
  lines.push('');
  lines.push(`- Source: ${String((c as any).sourceName || c.source || '')}`);
  if (isNonEmptyString(c.url)) lines.push(`- URL: ${String(c.url)}`);
  const lastActivityAt = formatIso(c.lastActivityAt);
  if (lastActivityAt) lines.push(`- Last Activity: ${lastActivityAt}`);
  if (Array.isArray(c.warningFlags) && c.warningFlags.length) {
    lines.push(`- Warnings: ${c.warningFlags.map(String).join(', ')}`);
  }
  lines.push('');
  const messageHeadingLevel = clampHeadingLevel(options.chatMessageHeadingLevel, 2);
  const messageHeading = headingPrefix(messageHeadingLevel);
  for (const m of messages || []) {
    const role = (m as any).role || 'assistant';
    const authorName = role === 'user' && isNonEmptyString((m as any).authorName) ? String((m as any).authorName) : '';
    lines.push(`${messageHeading} ${role === 'user' ? authorName || 'You' : role}`);
    lines.push('');
    lines.push(String((m as any).contentMarkdown || ''));
    lines.push('');
  }
  return lines.join('\n');
}

export function formatConversationMarkdown(
  conversation: Conversation,
  messages: ConversationMessage[],
  options: FormatConversationMarkdownOptions = {},
) {
  const sourceType = conversation?.sourceType ? String(conversation.sourceType) : '';
  if (sourceType === 'article') return formatArticleMarkdown(conversation, messages, options);
  if (sourceType === 'video') return formatVideoMarkdown(conversation, messages);
  return formatChatMarkdown(conversation, messages, options);
}
