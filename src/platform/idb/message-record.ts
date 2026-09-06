type UnknownRecord = Record<string, unknown>;

function toContentString(value: unknown): string {
  return value == null ? '' : String(value);
}

export function resolveMessageMarkdown(message: unknown): string {
  const record = message && typeof message === 'object' ? (message as UnknownRecord) : {};
  const markdown = toContentString(record.contentMarkdown);
  if (markdown.trim()) return markdown;
  return toContentString(record.contentText);
}

export function resolveIncomingMessageMarkdown(message: unknown): string {
  const record = message && typeof message === 'object' ? (message as UnknownRecord) : {};
  if (Object.prototype.hasOwnProperty.call(record, 'contentMarkdown')) {
    return toContentString(record.contentMarkdown);
  }
  return toContentString(record.contentText);
}

export function normalizeStoredMessageRecord(message: unknown): UnknownRecord {
  const record = message && typeof message === 'object' ? (message as UnknownRecord) : {};
  const next: UnknownRecord = {
    ...record,
    contentMarkdown: resolveMessageMarkdown(record),
  };
  delete next.contentText;
  return next;
}
