export type BuildChatWithCommentPayloadV1Input = {
  quoteText?: string | null;
  commentText?: string | null;
  articleTitle?: string | null;
  canonicalUrl?: string | null;
};

function safeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildChatWithCommentPayloadV1(input: BuildChatWithCommentPayloadV1Input): string {
  const commentText = safeText(input?.commentText);
  if (!commentText) return '';

  const quoteText = safeText(input?.quoteText);
  const articleTitle = safeText(input?.articleTitle);
  const canonicalUrl = safeText(input?.canonicalUrl);

  const lines: string[] = [
    '请基于以下信息，帮助我理解并回应这条评论。',
    '',
    `Article Title: ${articleTitle}`,
    `Article URL: ${canonicalUrl}`,
  ];

  if (quoteText) {
    lines.push('', 'Quote:', quoteText);
  }

  lines.push('', 'Comment:', commentText);

  // Keep a trailing newline for better paste behavior across chat platforms.
  return `${lines.join('\n')}\n`;
}
