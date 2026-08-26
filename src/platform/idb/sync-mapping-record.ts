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
const GITHUB_CONTINUITY_FIELDS = [
  'githubRemoteKey',
  'githubManagedFiles',
  'githubProjectionFingerprint',
  'githubLastSyncedAt',
] as const;
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

function isSafeGitRefName(value: string): boolean {
  if (!value || value === '@' || value.startsWith('/') || value.endsWith('/') || value.endsWith('.')) return false;
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return false;
  if (/[\x00-\x20\x7f]/.test(value)) return false;
  if (['~', '^', ':', '?', '*', '[', '\\'].some((character) => value.includes(character))) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock'))) return false;
  return true;
}

function normalizeGithubRemoteKey(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return '';
  const prefix = 'github.com/';
  if (!value.startsWith(prefix)) return '';
  const at = value.indexOf('@', prefix.length);
  if (at <= prefix.length || at >= value.length - 1) return '';
  const repo = value.slice(prefix.length, at);
  const branch = value.slice(at + 1);
  const [owner, repository, ...extra] = repo.split('/');
  if (extra.length || !owner || !repository) return '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return '';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === '.' || repository === '..') return '';
  if (!isSafeGitRefName(branch)) return '';
  return value;
}

function isSafeRelativeGitPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return false;
  if (value.startsWith('/') || value.includes('\\') || /[\x00-\x1f\x7f]/.test(value)) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  const lower = value.toLowerCase();
  if (lower === '.github/workflows' || lower.startsWith('.github/workflows/')) return false;
  return true;
}

function normalizeGithubManagedFiles(value: unknown): SyncMappingRecord {
  if (!isRecord(value)) return {};
  const normalized: SyncMappingRecord = {};
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [path, rawMetadata] of entries) {
    if (!isSafeRelativeGitPath(path) || !isRecord(rawMetadata)) continue;
    const sha = rawMetadata.sha;
    const contentHash = rawMetadata.contentHash;
    const kind = rawMetadata.kind;
    if (typeof sha !== 'string' || !/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(sha)) continue;
    if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) continue;
    if (kind !== 'markdown' && kind !== 'asset') continue;
    normalized[path] = { sha: sha.toLowerCase(), contentHash, kind };
  }
  return normalized;
}

export function readGithubContinuity(source: unknown): SyncMappingRecord {
  const record = asRecord(source);
  const remoteKey = normalizeGithubRemoteKey(record.githubRemoteKey);
  if (!remoteKey) return {};
  const normalized: SyncMappingRecord = { githubRemoteKey: remoteKey };
  if (Object.prototype.hasOwnProperty.call(record, 'githubManagedFiles')) {
    normalized.githubManagedFiles = normalizeGithubManagedFiles(record.githubManagedFiles);
  }
  const fingerprint = record.githubProjectionFingerprint;
  if (typeof fingerprint === 'string' && /^[0-9a-f]{64}$/.test(fingerprint)) {
    normalized.githubProjectionFingerprint = fingerprint;
  }
  const lastSyncedAt = record.githubLastSyncedAt;
  if (typeof lastSyncedAt === 'number' && Number.isFinite(lastSyncedAt) && lastSyncedAt >= 0) {
    normalized.githubLastSyncedAt = lastSyncedAt;
  }
  return normalized;
}

function replaceGithubGroup(target: SyncMappingRecord, source: unknown): void {
  replaceGroup(target, readGithubContinuity(source), GITHUB_CONTINUITY_FIELDS);
}

function hasGithubContinuityField(record: SyncMappingRecord): boolean {
  return GITHUB_CONTINUITY_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function githubContinuityTimestamp(record: SyncMappingRecord): number | null {
  return finiteNumber(record.githubLastSyncedAt) ?? finiteNumber(record.updatedAt);
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
  const hasGithubTargetPatch = Object.prototype.hasOwnProperty.call(incoming, 'githubRemoteKey');
  const githubTargetChanged =
    hasGithubTargetPatch &&
    normalizeGithubRemoteKey(base.githubRemoteKey) !== normalizeGithubRemoteKey(incoming.githubRemoteKey);
  const hasGithubPatch = hasGithubContinuityField(incoming);
  const next: SyncMappingRecord = { ...base };
  if (notionTargetChanged) {
    for (const field of NOTION_CONTINUITY_FIELDS) delete next[field];
  }
  if (feishuTargetChanged) {
    for (const field of FEISHU_CONTINUITY_FIELDS) delete next[field];
  }
  if (githubTargetChanged) {
    for (const field of GITHUB_CONTINUITY_FIELDS) delete next[field];
  }
  Object.assign(next, incoming);
  if (hasGithubPatch) {
    replaceGithubGroup(next, githubTargetChanged ? incoming : { ...base, ...incoming });
  }

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

  const desiredSource = safeString(identity?.source);
  const desiredConversationKey = safeString(identity?.conversationKey);
  const targetGithubRemoteKey = normalizeGithubRemoteKey(current.githubRemoteKey);
  const legacyGithubRemoteKey = normalizeGithubRemoteKey(previous.githubRemoteKey);
  const legacyIdentityMatches =
    !!safeString(previous.source) &&
    !!safeString(previous.conversationKey) &&
    safeString(previous.source) === desiredSource &&
    safeString(previous.conversationKey) === desiredConversationKey;
  if (targetGithubRemoteKey) replaceGithubGroup(next, current);
  else if (legacyGithubRemoteKey && legacyIdentityMatches) replaceGithubGroup(next, previous);
  else replaceGithubGroup(next, {});

  next.source = desiredSource;
  next.conversationKey = desiredConversationKey;
  if (hasTarget && Object.prototype.hasOwnProperty.call(current, 'id')) next.id = current.id;
  else if (Object.prototype.hasOwnProperty.call(previous, 'id')) next.id = previous.id;
  else delete next.id;

  return next;
}

export function mergeSyncMappingForImport(existing: unknown, incoming: unknown): SyncMappingRecord {
  const local = stripSyncMappingLocalId(existing);
  const imported = stripSyncMappingLocalId(incoming);

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

  const localGithubRemoteKey = normalizeGithubRemoteKey(local.githubRemoteKey);
  const importedGithubRemoteKey = normalizeGithubRemoteKey(imported.githubRemoteKey);
  let githubSource: SyncMappingRecord = {};
  if (!localGithubRemoteKey) {
    githubSource = importedGithubRemoteKey ? imported : {};
  } else if (!importedGithubRemoteKey || localGithubRemoteKey !== importedGithubRemoteKey) {
    githubSource = local;
  } else {
    const localSyncedAt = githubContinuityTimestamp(local);
    const importedSyncedAt = githubContinuityTimestamp(imported);
    if (localSyncedAt != null && importedSyncedAt != null)
      githubSource = localSyncedAt > importedSyncedAt ? local : imported;
    else if (localSyncedAt != null) githubSource = local;
    else githubSource = imported;
  }
  replaceGithubGroup(next, githubSource);

  const localUpdatedAt = finiteNumber(local.updatedAt);
  const importedUpdatedAt = finiteNumber(imported.updatedAt);
  if (localUpdatedAt != null || importedUpdatedAt != null) {
    next.updatedAt = Math.max(localUpdatedAt ?? -Infinity, importedUpdatedAt ?? -Infinity);
  }

  return next;
}
