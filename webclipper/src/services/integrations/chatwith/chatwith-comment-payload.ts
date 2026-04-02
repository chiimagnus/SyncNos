import { renderChatWithTemplate } from '@services/integrations/chatwith/chatwith-settings';

export type BuildChatWithCommentPayloadV1Input = {
  quoteText?: string | null;
  commentText?: string | null;
  articleTitle?: string | null;
  canonicalUrl?: string | null;
  promptTemplate?: string | null;
};

const DEFAULT_COMMENT_CHAT_WITH_TEMPLATE = [
  '请基于以下信息，帮助我理解并回应这条评论。',
  '',
  'Article Title: {{article_title}}',
  'Article URL: {{article_url}}',
  '',
  '{{article_content}}',
].join('\n');

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildChatWithCommentPayloadV1(input: BuildChatWithCommentPayloadV1Input): string {
  const commentText = safeText(input?.commentText);
  if (!commentText) return '';

  const quoteText = safeText(input?.quoteText);
  const articleTitle = safeText(input?.articleTitle);
  const canonicalUrl = safeText(input?.canonicalUrl);

  const articleContentLines: string[] = [];
  if (quoteText) {
    articleContentLines.push('Quote:', quoteText, '');
  }
  articleContentLines.push(commentText);

  const articleContent = articleContentLines.join('\n').trim();
  const rawPromptTemplate = String(input?.promptTemplate ?? '');
  const promptTemplate = rawPromptTemplate.trim() ? rawPromptTemplate : DEFAULT_COMMENT_CHAT_WITH_TEMPLATE;

  const rendered = renderChatWithTemplate(promptTemplate, {
    article_title: articleTitle,
    article_url: canonicalUrl,
    article_content: articleContent,
    conversation_markdown: articleContent,
  });

  // Keep a trailing newline for better paste behavior across chat platforms.
  return `${rendered}\n`;
}
