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
const NOTION_NESTED_FIELDS = ['notionSections', 'notionSectionCursors', 'notionSectionDigests'] as const;

function isRecord(value: unknown): value is SyncMappingRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): SyncMappingRecord {
  return isRecord(value) ? value : {};
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

function replaceGroup(target: SyncMappingRecord, source: SyncMappingRecord, fields: readonly string[]): void {
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

export function mergeSyncMappingPatch(existing: unknown, patch: unknown): SyncMappingRecord {
  const base = asRecord(existing);
  const incoming = stripSyncMappingLocalId(patch);
  const hasNotionTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'notionPageId');
  const notionTargetChanged =
    hasNotionTargetPatch && safeString(base.notionPageId) !== safeString(incoming.notionPageId);
  const hasFeishuTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'feishuDocId');
  const feishuTargetChanged = hasFeishuTargetPatch && safeString(base.feishuDocId) !== safeString(incoming.feishuDocId);
  const next: SyncMappingRecord = { ...base };
  if (notionTargetChanged) {
    for (const field of NOTION_CONTINUITY_FIELDS) delete next[field];
  }
  if (feishuTargetChanged) {
    for (const field of FEISHU_CONTINUITY_FIELDS) delete next[field];
  }
  Object.assign(next, incoming);

  const nestedBase = notionTargetChanged ? {} : base;
  for (const field of NOTION_NESTED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;
    const patchSections = incoming[field];
    if (!isRecord(patchSections)) {
      if (Object.prototype.hasOwnProperty.call(nestedBase, field)) next[field] = nestedBase[field];
      else delete next[field];
      continue;
    }

    const baseSections = asRecord(nestedBase[field]);
    const mergedSections: SyncMappingRecord = { ...baseSections };
    for (const [rawSectionId, sectionPatch] of Object.entries(patchSections)) {
      const sectionId = safeString(rawSectionId);
      if (!sectionId || !isRecord(sectionPatch)) continue;
      mergedSections[sectionId] = {
        ...asRecord(baseSections[sectionId]),
        ...sectionPatch,
      };
    }
    next[field] = mergedSections;
  }

  return next;
}

export function mergeSyncMappingForIdentityMove(
  target: unknown,
  legacy: unknown,
  identity: { source: unknown; conversationKey: unknown; fallbackNotionPageId?: unknown },
): SyncMappingRecord {
  const current = asRecord(target);
  const previous = asRecord(legacy);
  const hasTarget = Object.keys(current).length > 0;
  const next: SyncMappingRecord = hasTarget ? { ...previous, ...current } : { ...previous };

  const targetNotionPageId = safeString(current.notionPageId);
  const legacyNotionPageId = safeString(previous.notionPageId);
  const notionSource = targetNotionPageId ? current : legacyNotionPageId ? previous : hasTarget ? current : previous;
  replaceGroup(next, notionSource, NOTION_CONTINUITY_FIELDS);
  if (!safeString(next.notionPageId)) {
    const fallbackNotionPageId = safeString(identity?.fallbackNotionPageId);
    if (fallbackNotionPageId) next.notionPageId = fallbackNotionPageId;
  }

  const targetFeishuDocId = safeString(current.feishuDocId);
  const legacyFeishuDocId = safeString(previous.feishuDocId);
  const feishuSource = targetFeishuDocId ? current : legacyFeishuDocId ? previous : hasTarget ? current : previous;
  replaceGroup(next, feishuSource, FEISHU_CONTINUITY_FIELDS);

  next.source = safeString(identity?.source);
  next.conversationKey = safeString(identity?.conversationKey);
  if (hasTarget && Object.prototype.hasOwnProperty.call(current, 'id')) next.id = current.id;
  else if (Object.prototype.hasOwnProperty.call(previous, 'id')) next.id = previous.id;
  else delete next.id;

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
