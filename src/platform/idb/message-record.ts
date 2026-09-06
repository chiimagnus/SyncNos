type UnknownRecord = Record<string, unknown>;

export function normalizeLegacyMessageRecord(message: unknown): UnknownRecord {
  const record = message && typeof message === 'object' ? (message as UnknownRecord) : {};
  const markdown = record.contentMarkdown == null ? '' : String(record.contentMarkdown);
  const next: UnknownRecord = {
    ...record,
    contentMarkdown: markdown.trim() ? markdown : record.contentText == null ? '' : String(record.contentText),
  };
  delete next.contentText;
  return next;
}
