type SyncMappingRecord = Record<string, unknown>;

const NOTION_CONTINUITY_FIELDS = [
  'notionPageId',
  'notionPageUrl',
  'notionWorkspaceSlug',
  'lastSyncedMessageKey',
  'lastSyncedSequence',
  'lastSyncedAt',
  'lastSyncedMessageUpdatedAt',
  'notionSections',
  'notionSectionCursors',
  'notionSectionDigests',
] as const;

const FEISHU_CONTINUITY_FIELDS = ['feishuDocId', 'feishuLastContentHash'] as const;

function asRecord(value: unknown): SyncMappingRecord {
  return value && typeof value === 'object' ? (value as SyncMappingRecord) : {};
}

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function finiteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function replaceGroup(
  target: SyncMappingRecord,
  source: SyncMappingRecord,
  fields: readonly string[],
): void {
  for (const field of fields) {
    delete target[field];
    if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field];
  }
}

export function stripSyncMappingLocalId(record: unknown): SyncMappingRecord {
  const next = { ...asRecord(record) };
  delete next.id;
  return next;
}

export function mergeSyncMappingForImport(existing: unknown, incoming: unknown): SyncMappingRecord {
  const local = stripSyncMappingLocalId(existing);
  const imported = stripSyncMappingLocalId(incoming);

  if (!Object.keys(local).length) return imported;

  // Generic metadata is conservative: keep local values and only fill missing keys from the imported snapshot.
  const next: SyncMappingRecord = { ...imported, ...local };

  const localNotionPageId = safeString(local.notionPageId);
  const importedNotionPageId = safeString(imported.notionPageId);
  let notionSource = local;
  if (!localNotionPageId) {
    notionSource = imported;
  } else if (!importedNotionPageId) {
    notionSource = local;
  } else if (localNotionPageId !== importedNotionPageId) {
    notionSource = local;
  } else {
    const localSyncedAt = finiteNumber(local.lastSyncedAt);
    const importedSyncedAt = finiteNumber(imported.lastSyncedAt);
    notionSource =
      localSyncedAt != null && importedSyncedAt != null && localSyncedAt > importedSyncedAt ? local : imported;
  }
  replaceGroup(next, notionSource, NOTION_CONTINUITY_FIELDS);

  const localFeishuDocId = safeString(local.feishuDocId);
  const importedFeishuDocId = safeString(imported.feishuDocId);
  const feishuSource =
    !localFeishuDocId || (importedFeishuDocId && importedFeishuDocId === localFeishuDocId) ? imported : local;
  replaceGroup(next, feishuSource, FEISHU_CONTINUITY_FIELDS);

  const localUpdatedAt = finiteNumber(local.updatedAt);
  const importedUpdatedAt = finiteNumber(imported.updatedAt);
  if (localUpdatedAt != null || importedUpdatedAt != null) {
    next.updatedAt = Math.max(localUpdatedAt ?? -Infinity, importedUpdatedAt ?? -Infinity);
  }

  return next;
}
