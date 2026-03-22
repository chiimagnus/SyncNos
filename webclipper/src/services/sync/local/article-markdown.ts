function formatArticleMarkdown({ conversation, messages }: { conversation?: any; messages?: any[] }) {
  const c = conversation || {};
  const m0 = Array.isArray(messages) && messages.length ? messages[0] : null;
  const lines = [];
  lines.push(`# ${c.title || 'Untitled'}`);
  lines.push('');
  if (c.author) lines.push(`- Author: ${c.author}`);
  if (c.publishedAt) lines.push(`- Published: ${c.publishedAt}`);
  if (c.url) lines.push(`- URL: ${c.url}`);
  lines.push('');
  lines.push('## Content');
  lines.push('');
  lines.push(String((m0 && (m0.contentMarkdown || m0.contentText)) || ''));
  lines.push('');
  return lines.join('\n');
}

const api = { formatArticleMarkdown };

export { formatArticleMarkdown };
export default api;
