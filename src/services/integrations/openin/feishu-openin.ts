function safeString(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeFeishuDocId(docId?: string | null): string {
  return safeString(docId);
}

export function buildFeishuDocUrl(docId?: string | null): string {
  const token = normalizeFeishuDocId(docId);
  if (!token) return '';
  return `https://www.feishu.cn/docx/${encodeURIComponent(token)}`;
}
